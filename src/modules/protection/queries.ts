import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';import {uuid} from '../identity/common';import {scope} from '../field/common';import {AppError} from '../../platform/error';import {protectionPlan} from './plans';
export async function protectionOverview(c:PoolClient,a:Actor,objectId:string){
 uuid(objectId);await scope(c,a,objectId,'read');const result:Record<string,any>={limit:100};
 result.plans=(await c.query('SELECT id,title,crop,target,stage,input_lot_id,version,created_at FROM protection_plans WHERE object_id=$1 ORDER BY created_at DESC LIMIT 100',[objectId])).rows;
 result.prescriptions=(await c.query('SELECT id,plan_id,version,dose_unit,state,basis,review_note FROM prescription_maps WHERE object_id=$1 ORDER BY created_at DESC LIMIT 100',[objectId])).rows;
 result.executions=(await c.query("SELECT id,plan_id,prescription_id,operator,started_at,ended_at,material_quantity,unit,missing,coverage->'coveredM2' AS covered_m2,coverage->'missedM2' AS missed_m2,coverage->'overlapM2' AS overlap_m2,remediation_of,cause,remediation_cost,evidence FROM protection_executions WHERE object_id=$1 ORDER BY created_at DESC LIMIT 100",[objectId])).rows;
 for(const [name,table] of Object.entries({deliveries:'protection_deliveries',followups:'protection_followups',events:'prescription_events'}))result[name]=(await c.query('SELECT * FROM '+table+' WHERE object_id=$1 ORDER BY created_at DESC LIMIT 100',[objectId])).rows;
 result.imports=(await c.query('SELECT id,source_ref,input_hash,result_rows,created_at FROM protection_imports WHERE object_id=$1 ORDER BY created_at DESC LIMIT 100',[objectId])).rows;
 result.lots=(await c.query("SELECT id,code,product,unit,state FROM stock_lots WHERE object_id=$1 AND kind='input' ORDER BY created_at DESC LIMIT 200",[objectId])).rows;
 result.media=(await c.query("SELECT id,name,mime FROM media_assets WHERE object_id=$1 AND ingest_state='complete' ORDER BY created_at DESC LIMIT 200",[objectId])).rows;return result;
}
export async function executionDetail(c:PoolClient,a:Actor,id:string){uuid(id);const e=(await c.query('SELECT * FROM protection_executions WHERE id=$1',[id])).rows[0];if(!e)throw new AppError(404,'EXECUTION_NOT_FOUND','作业不存在');await scope(c,a,e.object_id,'read','protection_execution',e.id);const p=await protectionPlan(c,a,e.plan_id);return {execution:e,plan:p};}

