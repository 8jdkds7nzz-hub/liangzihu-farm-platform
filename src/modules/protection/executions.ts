import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';import {AppError} from '../../platform/error';
import {text,time,finite,integer,choice,optionalText} from '../../platform/validation';import {uuid} from '../identity/common';
import {request,type Body} from '../inventory/common';import {quantity} from '../inventory/quantity';import {protectionPlan} from './plans';import {prescription} from './prescriptions';
export type TrackPoint={time:string;longitude:number|null;latitude:number|null;spraying:boolean|null;flow:number|null;flowUnit:string|null};
export function trackPoints(value:unknown,start:string,end:string):TrackPoint[]{
 start=time(start);end=time(end);
 if(!Array.isArray(value)||value.length>1000)throw new AppError(400,'PROTECTION_TRACK','轨迹须为最多1000点的数组，资料未知可传空数组');
 const rows=value.map(x=>{
 const at=time(x?.time);if(at<start||at>end)throw new AppError(422,'TRACK_TIME','轨迹时刻须在作业时段内');
 const nullable=(v:unknown)=>v===null||v===undefined?null:finite(v,'轨迹数值'),lon=nullable(x.longitude),lat=nullable(x.latitude),flow=nullable(x.flow);
 if((lon===null)!==(lat===null)||lon!==null&&(lon< -180||lon>180)||lat!==null&&(lat< -90||lat>90)||flow!==null&&flow<0)throw new AppError(400,'TRACK_VALUE','经纬度须成对有效，流量须非负');
 if(x.spraying!==null&&x.spraying!==undefined&&typeof x.spraying!=='boolean')throw new AppError(400,'TRACK_SWITCH','启停须为true、false或未知');
 const flowUnit=optionalText(x.flowUnit,'原流量单位',40);
 return {time:at,longitude:lon,latitude:lat,spraying:x.spraying??null,flow,flowUnit};
 }).sort((a,b)=>a.time.localeCompare(b.time));
 for(let i=1;i<rows.length;i++)if(rows[i].time===rows[i-1].time)throw new AppError(409,'TRACK_CONFLICT','同一轨迹时刻重复，请先核对冲突');return rows;
}
export function spraySegments(track:TrackPoint[],maxGap:number|null){
 const segments:{type:string;coordinates:number[][]}[]=[],gaps:Record<string,unknown>[]=[];
 for(let i=1;i<track.length;i++){const a=track[i-1],b=track[i],gap=(Date.parse(b.time)-Date.parse(a.time))/1000;
 const units=['L/min','L/s','mL/s','kg/min','g/s','kg/s'];
 if(a.longitude===null||b.longitude===null||a.spraying!==true||b.spraying!==true||a.flow===null||b.flow===null||a.flow===0||b.flow===0||!units.includes(a.flowUnit??'')||a.flowUnit!==b.flowUnit||maxGap===null||gap>maxGap){
 gaps.push({from:a.time,to:b.time,position:b.longitude===null?null:[b.longitude,b.latitude],reason:maxGap===null?'连续条件未核实':gap>maxGap?'轨迹中断或间隔超限':'坐标、启停或流量不足以证明连续喷施'});continue;}
 if(a.longitude!==b.longitude||a.latitude!==b.latitude)segments.push({type:'LineString',coordinates:[[a.longitude,a.latitude!],[b.longitude,b.latitude!]]});
 }return {segments,gaps};
}
async function coverage(c:PoolClient,p:any,track:TrackPoint[],swath:number|null,gap:number|null){
 const parts=spraySegments(track,gap),limits=['轨迹、启停与流量推算的疑似覆盖，不是实际药液沉积或农艺效果确认'];
 if(swath===null||!parts.segments.length)return {coveredM2:null,missedM2:null,overlapM2:null,missingGeometry:null,overlapGeometry:null,gaps:parts.gaps,limitations:limits.concat('轨迹、喷幅或连续条件不足，未计算覆盖率')};
 if(parts.segments.length>500)throw new AppError(413,'COVERAGE_LIMIT','有效轨迹段超过500，请按独立作业段拆分导入');
 const result=(await c.query(`WITH boundary AS(SELECT ST_GeomFromGeoJSON($1) AS g),
 seg AS(SELECT n::int AS i,ST_Intersection(ST_Buffer(ST_GeomFromGeoJSON(v)::geography,$3)::geometry,b.g) AS g FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY x(v,n) CROSS JOIN boundary b),
 joined AS(SELECT ST_UnaryUnion(ST_Collect(g)) AS g FROM seg),
 overlap AS(SELECT ST_UnaryUnion(ST_Collect(ST_Intersection(a.g,b.g))) AS g FROM seg a JOIN seg b ON b.i>a.i+1 AND a.g&&b.g)
 SELECT ST_Area(j.g::geography) AS covered,ST_Area(ST_Difference(b.g,j.g)::geography) AS missed,
 COALESCE(ST_Area(o.g::geography),0) AS overlap,ST_AsGeoJSON(ST_Difference(b.g,j.g))::jsonb AS missing_geometry,ST_AsGeoJSON(o.g)::jsonb AS overlap_geometry
 FROM boundary b CROSS JOIN joined j CROSS JOIN overlap o`,[JSON.stringify(p.boundary),JSON.stringify(parts.segments),swath/2])).rows[0];
 return {coveredM2:result.covered,missedM2:result.missed,overlapM2:result.overlap,missingGeometry:result.missing_geometry,overlapGeometry:result.overlap_geometry,gaps:parts.gaps,limitations:limits.concat('相邻段的端帽交叠不计重作；无效轨迹部分仍是缺口')};
}
export async function recordExecution(c:PoolClient,a:Actor,b:Body){
 const p=await protectionPlan(c,a,b.planId,'record');return request(c,a,b,'protection.execution',p.object_id,async()=>{
 const start=time(b.startedAt),end=time(b.endedAt);if(end<start)throw new AppError(422,'EXECUTION_PERIOD','结束时间不能早于开始');
 const track=trackPoints(b.track??[],start,end),swath=b.swathM==null||b.swathM===''?null:finite(b.swathM,'已核喷幅米'),gap=b.maxGapSeconds==null||b.maxGapSeconds===''?null:integer(b.maxGapSeconds,'已核最大连续间隔秒',1,3600);
 if(swath!==null&&(swath<=0||swath>100))throw new AppError(422,'SWATH_RANGE','喷幅须大于0且不超过100米');
 const unit=choice(b.unit,['kg','L','piece'] as const,'实际材料单位'),q=b.materialQuantity==null||b.materialQuantity===''?null:quantity(b.materialQuantity,unit);
 if((await c.query('SELECT unit FROM stock_lots WHERE id=$1',[p.input_lot_id])).rows[0].unit!==unit)throw new AppError(422,'MATERIAL_UNIT','实际材料单位须与投入品批次一致，不自动换算');
 if(b.prescriptionId){const r=await prescription(c,a,b.prescriptionId);if(r.plan_id!==p.id||r.state!=='approved'||!r.reviewed_at||new Date(start)<r.reviewed_at)throw new AppError(422,'EXECUTION_PRESCRIPTION','处方须同计划、已批准且批准时间不晚于作业开始');}
 let cause=null,cost=null;if(b.remediationOf){uuid(b.remediationOf);const old=(await c.query('SELECT * FROM protection_executions WHERE id=$1',[b.remediationOf])).rows[0];if(old?.plan_id!==p.id||new Date(start)<old.ended_at)throw new AppError(422,'REMEDIATION_SCOPE','补作须关联同计划已结束的原作业');cause=choice(b.cause,['data_equipment','environment','organization'] as const,'补作原因类别');cost=b.remediationCost==null||b.remediationCost===''?null:quantity(b.remediationCost);}
 const missing=[];if(!track.length)missing.push('轨迹缺失');if(track.some(x=>x.spraying===null))missing.push('启停缺失');if(track.some(x=>x.flow===null))missing.push('流量缺失');if(track.some(x=>x.flow!==null&&!x.flowUnit))missing.push('流量单位缺失');if(q===null)missing.push('实际材料量未知');if(!b.resultCheck)missing.push('结果复查待补');if(q!==null)missing.push('材耗为作业自报，需与独立投入品施用记录对账');
 return(await c.query('INSERT INTO protection_executions(object_id,plan_id,prescription_id,operator,started_at,ended_at,track,swath_m,max_gap_seconds,material_quantity,unit,missing,coverage,result_check,remediation_of,cause,remediation_cost,evidence,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *',[p.object_id,p.id,b.prescriptionId||null,text(b.operator,'实际操作者',200),start,end,JSON.stringify(track),swath,gap,q,unit,JSON.stringify(missing),await coverage(c,p,track,swath,gap),optionalText(b.resultCheck,'结果复查',4000),b.remediationOf||null,cause,cost,text(b.evidence,'作业原始依据',4000),a.id])).rows[0];
 });
}
