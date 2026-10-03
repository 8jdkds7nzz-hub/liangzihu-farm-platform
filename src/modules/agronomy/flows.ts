import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';import {AppError} from '../../platform/error';
import {text,time,choice} from '../../platform/validation';import {uuid} from '../identity/common';import {access,request,type Body} from '../inventory/common';import {quantity} from '../inventory/quantity';
export async function recordFlow(c:PoolClient,a:Actor,b:Body){
 await access(c,a,b.objectId);const source=choice(b.sourceKind,['measured','calibrated','model'] as const,'流量来源');if(source!=='measured')await access(c,a,b.objectId,'review');
 return request(c,a,b,'agronomy.flow',b.objectId as string,async()=>{
 const from=time(b.fromAt),to=time(b.toAt),until=time(b.validUntil);if(to<from||until<to)throw new AppError(422,'FLOW_PERIOD','观测和依据有效期不一致');
 if(b.deviceId){uuid(b.deviceId);if((await c.query('SELECT object_id FROM devices WHERE id=$1',[b.deviceId])).rows[0]?.object_id!==b.objectId)throw new AppError(422,'FLOW_SCOPE','设备不属于观测对象');}
 if(b.pointId){uuid(b.pointId);const p=(await c.query('SELECT d.object_id,p.device_id FROM points p JOIN devices d ON d.id=p.device_id WHERE p.id=$1',[b.pointId])).rows[0];if(p?.object_id!==b.objectId||b.deviceId&&p.device_id!==b.deviceId)throw new AppError(422,'FLOW_SCOPE','测点与对象或设备不符');}
 return(await c.query('INSERT INTO flow_observations(object_id,device_id,point_id,from_at,to_at,value,unit,source_kind,basis_ref,basis_version,applicability,valid_until,reviewed_by,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *',[b.objectId,b.deviceId||null,b.pointId||null,from,to,b.value==null||b.value===''?null:quantity(b.value),choice(b.unit,['m3/s','m3'] as const,'单位'),source,text(b.basisRef,'仪器、率定或模型依据',4000),text(b.basisVersion,'依据版本',200),text(b.applicability,'适用范围',2000),until,source==='measured'?null:a.id,a.id])).rows[0];
 });
}

