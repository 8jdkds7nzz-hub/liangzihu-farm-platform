import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';import {AppError} from '../../platform/error';
import {text,choice,integer,time,optionalText} from '../../platform/validation';import {uuid} from '../identity/common';import {quantity,positive,micros} from '../inventory/quantity';
import {access,request,independent,period,type Body} from '../phase4/common';import {calculateEnergy} from './math';
import {getPointHistory} from '../telemetry/queries';
export const metrics=['generation_kwh','consumption_kwh','charge_kwh','discharge_kwh','power_kw','soc_pct','soh_pct'] as const;
export async function energyMeter(c:PoolClient,a:Actor,id:unknown,action:'read'|'record'|'review'='read'){
 uuid(id);const r=(await c.query(`SELECT m.*,COALESCE((SELECT action='approve' FROM energy_meter_reviews WHERE meter_id=m.id ORDER BY seq DESC LIMIT 1),false) AND d.verified AND m.object_id=d.object_id AS verified FROM energy_meters m JOIN devices d ON d.id=m.device_id WHERE m.id=$1`,[id])).rows[0];
 if(!r)throw new AppError(404,'ENERGY_METER','能源档案不存在');await access(c,a,r.object_id,action);r.current=!(await c.query('SELECT 1 FROM energy_meters WHERE supersedes_id=$1',[r.id])).rowCount;r.verified=r.verified&&r.current;if(action!=='read'&&!r.current)throw new AppError(409,'ENERGY_VERSION','档案已有新版本，请重新核对');return r;
}
export async function registerEnergyMeter(c:PoolClient,a:Actor,b:Body){
 await access(c,a,b.objectId,'configure');return request(c,a,b,'energy.meter',b.objectId as string,async()=>{
 uuid(b.deviceId);const d=(await c.query('SELECT * FROM devices WHERE id=$1 FOR UPDATE',[b.deviceId])).rows[0];if(d?.object_id!==b.objectId||d.kind!=='physical')throw new AppError(422,'ENERGY_DEVICE','须关联当前对象的物理设备');
 const purpose=choice(b.purpose,['generation','load','storage'] as const,'用途'),old=(await c.query('SELECT * FROM energy_meters WHERE device_id=$1 AND purpose=$2 ORDER BY version DESC LIMIT 1',[d.id,purpose])).rows[0];if(old&&b.supersedesId!==old.id||!old&&b.supersedesId)throw new AppError(409,'ENERGY_VERSION','同设备用途已有档案，修订须引用当前版本');
 if(b.oxygenPointId){uuid(b.oxygenPointId);if(!(await c.query('SELECT 1 FROM point_bindings WHERE point_id=$1 AND object_id=$2 AND verified AND valid_from<=clock_timestamp() AND (valid_to IS NULL OR valid_to>clock_timestamp())',[b.oxygenPointId,b.objectId])).rowCount)throw new AppError(422,'ENERGY_POINT','参考测点须已有当前对象的已核绑定');}
 return(await c.query('INSERT INTO energy_meters(object_id,device_id,name,purpose,capacity_kwh,max_gap_seconds,source_ref,created_by,oxygen_point_id,version,supersedes_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[b.objectId,d.id,text(b.name,'能源档案名称'),purpose,b.capacityKwh==null||b.capacityKwh===''?null:positive(b.capacityKwh),integer(b.maxGapSeconds,'已核观测间隔秒',1,604800),text(b.sourceRef,'计量单位、倍率换算与资料依据',4000),a.id,b.oxygenPointId||null,(old?.version??0)+1,old?.id??null])).rows[0];
 });
}
export async function reviewEnergyMeter(c:PoolClient,a:Actor,b:Body){const m=await energyMeter(c,a,b.id,'review');return request(c,a,b,'energy.review',m.object_id,async()=>{independent(a,m.created_by);return(await c.query('INSERT INTO energy_meter_reviews(object_id,meter_id,action,evidence,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *',[m.object_id,m.id,choice(b.action,['approve','withdraw'] as const,'核实动作'),text(b.evidence,'核实依据',4000),a.id])).rows[0];});}
export async function recordEnergyReading(c:PoolClient,a:Actor,b:Body){const m=await energyMeter(c,a,b.meterId,'record');return request(c,a,b,'energy.reading',m.object_id,async()=>{
 await c.query('SELECT id FROM energy_meters WHERE id=$1 FOR UPDATE',[m.id]);const metric=choice(b.metric,metrics,'能源指标'),at=time(b.observedAt),value=b.value==null||b.value===''?null:quantity(b.value),quality=choice(b.quality,['valid','suspect','missing'] as const,'质量');
 if(value!==null&&metric.endsWith('_pct')&&micros(value)>100000000n||quality==='valid'&&value===null)throw new AppError(422,'ENERGY_RANGE','百分比须0至100，缺失值不能标有效');
 const old=(await c.query('SELECT * FROM energy_readings WHERE meter_id=$1 AND metric=$2 AND observed_at=$3 ORDER BY version DESC LIMIT 1',[m.id,metric,at])).rows[0];
 if(old&&b.supersedesId!==old.id||!old&&b.supersedesId)throw new AppError(409,'ENERGY_REVISION','已有同一时点观测，修订须明确引用当前版本');
 return(await c.query('INSERT INTO energy_readings(object_id,meter_id,metric,value,observed_at,quality,reset,source_kind,evidence,operating_state,alarm_note,version,supersedes_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *',[m.object_id,m.id,metric,value,at,quality,b.reset===true,choice(b.sourceKind,['manual','file'] as const,'来源性质'),text(b.evidence,'观测原件与单位换算依据',4000),choice(b.operatingState??'unknown',['charging','discharging','idle','unknown'] as const,'运行状态'),optionalText(b.alarmNote,'异常状态',2000),(old?.version??0)+1,old?.id??null,a.id])).rows[0];
 });}
export async function energySummary(c:PoolClient,a:Actor,b:Body){const m=await energyMeter(c,a,b.meterId),metric=choice(b.metric,['generation_kwh','consumption_kwh','charge_kwh','discharge_kwh'] as const,'累计电量指标'),{start,end}=period(b.fromAt,b.toAt);
 const rows=(await c.query('SELECT r.* FROM energy_readings r WHERE meter_id=$1 AND metric=$2 AND observed_at>=$3 AND observed_at<=$4 AND NOT EXISTS(SELECT 1 FROM energy_readings n WHERE n.supersedes_id=r.id) ORDER BY observed_at,id LIMIT 10001',[m.id,metric,start,end])).rows;
 if(rows.length>10000)throw new AppError(413,'ENERGY_LIMIT','区间超过10000条，请缩短时段');
 let environmentalReference:any=null,referenceGap='未关联已核溶解氧等环境参考测点';
 if(m.oxygen_point_id){if(Date.parse(end)-Date.parse(start)>31*86400000)referenceGap='环境参考最多读取31天，请缩短时段';else{
 const h=await getPointHistory(c,a,m.oxygen_point_id,{from:start,to:end,limit:500});environmentalReference={point:h.point,items:h.items.filter((r:any)=>r.object_id===m.object_id),dataState:h.dataState,nextCursor:h.nextCursor,current:h.current?.object_id===m.object_id?h.current:null};referenceGap=h.nextCursor?'环境记录超过500条，参考显示不完整':'仅并列环境观测，不据此自动开机或给出错峰指令';}}
 return {...calculateEnergy(rows,start,end,m.max_gap_seconds,m.verified),meterId:m.id,metric,unit:'kWh',inputs:rows,environmentalReference,referenceGap};
}
