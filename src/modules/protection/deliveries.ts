import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';import {AppError} from '../../platform/error';
import {text,time,choice} from '../../platform/validation';import {uuid} from '../identity/common';import {scope,arrayIds} from '../field/common';import {request,type Body} from '../inventory/common';import {protectionPlan} from './plans';
export async function recordDelivery(c:PoolClient,a:Actor,b:Body){
 const p=await protectionPlan(c,a,b.planId,'record');return request(c,a,b,'protection.delivery',p.object_id,async()=>{
 const ids=arrayIds(b.assetIds??[],100);for(const id of ids){const m=(await c.query('SELECT * FROM media_assets WHERE id=$1',[id])).rows[0];if(m?.object_id!==p.object_id||m.ingest_state!=='complete')throw new AppError(422,'DELIVERY_ASSET','交付原件须完整入库且属于当前对象');await scope(c,a,p.object_id,'read','media',id);}
 return(await c.query('INSERT INTO protection_deliveries(object_id,plan_id,provider,kind,asset_ids,missing,received_by,occurred_at,evidence,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[p.object_id,p.id,text(b.provider,'服务商',200),choice(b.kind,['raw_images','processed','work_order','track','arrival','followup'] as const,'交付类型'),ids,text(b.missing,'完整性或缺项说明',2000),text(b.receivedBy,'实际接收人',200),time(b.occurredAt),text(b.evidence,'交付依据',4000),a.id])).rows[0];
 });
}
export async function recordFollowup(c:PoolClient,a:Actor,b:Body){
 uuid(b.executionId);const e=(await c.query('SELECT * FROM protection_executions WHERE id=$1',[b.executionId])).rows[0];if(!e)throw new AppError(404,'EXECUTION_NOT_FOUND','原作业不存在');const p=await protectionPlan(c,a,e.plan_id,'record');
 return request(c,a,b,'protection.followup',p.object_id,async()=>{const at=time(b.occurredAt);if(new Date(at)<e.ended_at)throw new AppError(422,'FOLLOWUP_TIME','复查须在作业结束之后');
 return(await c.query('INSERT INTO protection_followups(object_id,execution_id,observation,judgment,action,occurred_at,evidence,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[p.object_id,e.id,text(b.observation,'现场观察',4000),text(b.judgment,'人员判断',4000),text(b.action,'后续动作或无动作说明',4000),at,text(b.evidence,'复查依据',4000),a.id])).rows[0];});
}

