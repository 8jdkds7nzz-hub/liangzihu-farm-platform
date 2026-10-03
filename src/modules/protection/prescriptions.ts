import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';import {AppError} from '../../platform/error';
import {text,time,choice} from '../../platform/validation';import {uuid} from '../identity/common';import {scope} from '../field/common';
import {request,type Body} from '../inventory/common';import {quantity} from '../inventory/quantity';import {protectionPlan,polygon} from './plans';
export async function prescription(c:PoolClient,a:Actor,id:unknown,action:'read'|'record'|'review'='read'){
 uuid(id);const r=(await c.query('SELECT * FROM prescription_maps WHERE id=$1',[id])).rows[0];if(!r)throw new AppError(404,'PRESCRIPTION_NOT_FOUND','处方不存在');
 await scope(c,a,r.object_id,'read','prescription_map',r.id);if(action!=='read')await scope(c,a,r.object_id,action,'prescription_map',r.id);return r;
}
export async function createPrescription(c:PoolClient,a:Actor,b:Body){
 const p=await protectionPlan(c,a,b.planId,'record');return request(c,a,b,'protection.prescription',p.object_id,async()=>{
 await c.query('SELECT id FROM protection_plans WHERE id=$1 FOR UPDATE',[p.id]);
 if(!Array.isArray(b.zones)||!b.zones.length||b.zones.length>5)throw new AppError(400,'PRESCRIPTION_ZONES','处方分区须为1至5层');
 const zones=[];for(const z of b.zones){const geometry=await polygon(c,z.geometry),rate=quantity(z.rate);
 const inside=(await c.query('SELECT ST_Covers(ST_GeomFromGeoJSON($1),ST_GeomFromGeoJSON($2)) AS ok',[JSON.stringify(p.boundary),JSON.stringify(geometry)])).rows[0].ok;if(!inside)throw new AppError(422,'PRESCRIPTION_OUTSIDE','处方分区超出计划边界');
 for(const old of zones){const overlap=(await c.query('SELECT ST_Area(ST_Intersection(ST_GeomFromGeoJSON($1),ST_GeomFromGeoJSON($2))::geography)>0.01 AS overlap',[JSON.stringify(old.geometry),JSON.stringify(geometry)])).rows[0].overlap;if(overlap)throw new AppError(422,'PRESCRIPTION_OVERLAP','处方分区相互重叠');}
 zones.push({name:text(z.name,'分区名称',120),rate,geometry});}
 if(b.sourceAssetId){uuid(b.sourceAssetId);const m=(await c.query('SELECT * FROM media_assets WHERE id=$1',[b.sourceAssetId])).rows[0];if(m?.object_id!==p.object_id||m.ingest_state!=='complete')throw new AppError(422,'PRESCRIPTION_SOURCE','来源影像须完整入库且对象一致');await scope(c,a,p.object_id,'read','media',m.id);}
 if(b.sourceAnalysisId){uuid(b.sourceAnalysisId);if((await c.query("SELECT 1 FROM spectral_products WHERE id=$1 AND object_id=$2 AND state='complete'",[b.sourceAnalysisId,p.object_id])).rowCount!==1)throw new AppError(422,'PRESCRIPTION_SOURCE','指数来源须为同对象已完成产品');}
 const version=Number((await c.query('SELECT COALESCE(max(version),0)+1 AS v FROM prescription_maps WHERE plan_id=$1',[p.id])).rows[0].v);
 return(await c.query('INSERT INTO prescription_maps(object_id,plan_id,version,source_asset_id,source_analysis_id,zones,dose_unit,basis,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[p.object_id,p.id,version,b.sourceAssetId||null,b.sourceAnalysisId||null,JSON.stringify(zones),choice(b.doseUnit,['kg/亩','L/亩','g/亩','mL/亩'] as const,'每亩剂量单位'),text(b.basis,'专业剂量与来源依据',4000),a.id])).rows[0];
 });
}
export async function reviewPrescription(c:PoolClient,a:Actor,b:Body){
 const old=await prescription(c,a,b.id,'review');return request(c,a,b,'protection.prescription-review',old.object_id,async()=>{
 const r=(await c.query('SELECT * FROM prescription_maps WHERE id=$1 FOR UPDATE',[old.id])).rows[0],action=choice(b.action,['approve','withdraw'] as const,'审核动作');
 if(action==='approve'&&(r.created_by===a.id||r.state!=='draft'))throw new AppError(409,'PRESCRIPTION_REVIEW','须由其他审核人员确认尚未审核的草稿');
 return(await c.query('UPDATE prescription_maps SET state=$2,reviewed_by=$3,reviewed_at=now(),review_note=$4 WHERE id=$1 RETURNING *',[r.id,action==='approve'?'approved':'withdrawn',a.id,text(b.evidence,'专业审核依据',4000)])).rows[0];
 });
}
export async function prescriptionEvent(c:PoolClient,a:Actor,b:Body){
 const r=await prescription(c,a,b.prescriptionId,'record');return request(c,a,b,'protection.prescription-event',r.object_id,async()=>{
 await c.query('SELECT id FROM prescription_maps WHERE id=$1 FOR SHARE',[r.id]);if((await c.query('SELECT state FROM prescription_maps WHERE id=$1',[r.id])).rows[0].state!=='approved')throw new AppError(409,'PRESCRIPTION_NOT_APPROVED','处方尚未批准或已撤回');
 const action=choice(b.action,['shared','downloaded','applied'] as const,'处方事实');
 if(action==='applied'){uuid(b.executionId);if((await c.query('SELECT prescription_id FROM protection_executions WHERE id=$1',[b.executionId])).rows[0]?.prescription_id!==r.id)throw new AppError(422,'PRESCRIPTION_EXECUTION','已施用须关联该处方的实际作业');}
 return(await c.query('INSERT INTO prescription_events(object_id,prescription_id,action,execution_id,party,occurred_at,evidence,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[r.object_id,r.id,action,action==='applied'?b.executionId:null,text(b.party,'相关主体',200),time(b.occurredAt),text(b.evidence,'事实依据',4000),a.id])).rows[0];
 });
}
