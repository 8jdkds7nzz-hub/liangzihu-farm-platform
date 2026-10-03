import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';import {AppError} from '../../platform/error';
import {text} from '../../platform/validation';import {uuid} from '../identity/common';import {scope} from '../field/common';import {access,request,lot,type Body} from '../inventory/common';import {normalizePolygon} from '../map/geometry';
export async function polygon(c:PoolClient,g:unknown){try{await normalizePolygon(c,g,4326);}catch{throw new AppError(400,'PROTECTION_GEOMETRY','请提供有效WGS84地块面边界');}return g;}
export async function protectionPlan(c:PoolClient,a:Actor,id:unknown,action:'read'|'record'|'review'='read'){
 uuid(id);const r=(await c.query('SELECT * FROM protection_plans WHERE id=$1',[id])).rows[0];if(!r)throw new AppError(404,'PROTECTION_PLAN_NOT_FOUND','植保计划不存在');
 await scope(c,a,r.object_id,'read','protection_plan',r.id);if(action!=='read')await scope(c,a,r.object_id,action,'protection_plan',r.id);return r;
}
export async function createProtectionPlan(c:PoolClient,a:Actor,b:Body){
 await access(c,a,b.objectId);return request(c,a,b,'protection.plan',b.objectId as string,async()=>{
 const input=await lot(c,a,b.inputLotId,'read');if(input.object_id!==b.objectId||input.kind!=='input')throw new AppError(422,'PROTECTION_SCOPE','投入品须为同一对象的投入品批次');
 if(b.taskId){uuid(b.taskId);if((await c.query('SELECT object_id FROM field_tasks WHERE id=$1',[b.taskId])).rows[0]?.object_id!==b.objectId)throw new AppError(422,'PROTECTION_SCOPE','任务不属于当前对象');}
 const areas=b.sensitiveAreas??[];if(!Array.isArray(areas)||areas.length>30)throw new AppError(400,'PROTECTION_SENSITIVE','敏感邻区最多30项');const sensitive=[];
 for(const area of areas)sensitive.push({name:text(area.name,'敏感区域名称',120),kind:text(area.kind,'敏感对象类型',120),geometry:await polygon(c,area.geometry)});
 let version=1;if(b.supersedesId){const old=await protectionPlan(c,a,b.supersedesId,'record');await c.query('SELECT id FROM protection_plans WHERE id=$1 FOR UPDATE',[old.id]);if(old.object_id!==b.objectId||(await c.query('SELECT 1 FROM protection_plans WHERE supersedes_id=$1',[old.id])).rowCount)throw new AppError(409,'PROTECTION_VERSION','原计划范围不符或已被修订');version=old.version+1;}
 return(await c.query('INSERT INTO protection_plans(object_id,title,crop,target,stage,boundary,obstacles,sensitive_areas,sensitive_note,conditions,input_lot_id,task_id,source,version,supersedes_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *',[b.objectId,text(b.title,'计划标题',200),text(b.crop,'作物',120),text(b.target,'作业目标',200),text(b.stage,'已核生育阶段',120),JSON.stringify(await polygon(c,b.boundary)),text(b.obstacles,'障碍及位置说明',4000),JSON.stringify(sensitive),text(b.sensitiveNote,'敏感邻区核实说明',4000),text(b.conditions,'执行条件及依据',4000),input.id,b.taskId||null,text(b.source,'计划来源',4000),version,b.supersedesId||null,a.id])).rows[0];
 });
}

