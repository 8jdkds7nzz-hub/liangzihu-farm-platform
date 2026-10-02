import type {PoolClient} from 'pg';
import type {Actor} from '../../platform/types';
import {AppError} from '../../platform/error';
import {integer,finite,text} from '../../platform/validation';
import {uuid} from '../identity/common';
import {scope,payloadHash,sameHash,arrayIds} from '../field/common';
import {recordUsage} from '../operations/budget';
export async function confirmModelReceipt(c:PoolClient,a:Actor,b:Record<string,unknown>){
 uuid(b.runId);const r=(await c.query('SELECT * FROM assistant_runs WHERE id=$1 FOR UPDATE',[b.runId])).rows[0];if(!r)throw new AppError(404,'ASSISTANT_NOT_FOUND','问答不存在');for(const id of r.object_ids)await scope(c,a,id,'configure');
 if(b.confirm!==true||!Array.isArray(b.costs))throw new AppError(400,'RECEIPT_CONFIRM','须核对账单并明确确认');
 const costs=b.costs.map(x=>{uuid(x.objectId);const amount=finite(x.amountCny,'已核账单金额');if(amount<0)throw new AppError(400,'RECEIPT_AMOUNT','账单不能为负');return {objectId:x.objectId,amountCny:amount,inputTokens:integer(x.inputTokens,'已核输入token',0),outputTokens:integer(x.outputTokens,'已核输出token',0),calls:integer(x.calls,'已核调用数',0)};}).sort((a,b)=>a.objectId.localeCompare(b.objectId));
 const ids=arrayIds(costs.map(x=>x.objectId),20);if(ids.length!==r.object_ids.length||ids.some(id=>!r.object_ids.includes(id)))throw new AppError(422,'RECEIPT_SCOPE','账单须覆盖原请求全部对象的分摊');
 const evidence=text(b.evidence,'账单/回执依据及分摊说明',2000),hash=payloadHash({costs,evidence}),old=(await c.query('SELECT content_hash FROM model_receipts WHERE run_id=$1',[r.id])).rows[0];if(old){sameHash(old.content_hash,hash);return {id:r.id,state:'receipt_confirmed'};}
 const reservations=(await c.query('SELECT * FROM model_reservations WHERE run_id=$1 FOR UPDATE',[r.id])).rows;
 if(!reservations.length||reservations.some(m=>m.state!=='unknown')||r.state==='running')throw new AppError(409,'RECEIPT_STATE','仅核实已停止的未知账单，不修改已结算或正在执行的调用');
 const usage=(await c.query('SELECT id FROM usage_events WHERE business_key=ANY($1::text[])',[r.object_ids.map((id:string)=>'model-run:'+r.id+':'+id)])).rows.map(x=>x.id);
 await c.query('INSERT INTO model_receipts(run_id,confirmed_by,content_hash,costs,evidence,resolved_usage_ids) VALUES($1,$2,$3,$4,$5,$6)',[r.id,a.id,hash,JSON.stringify(costs),evidence,usage]);
 for(const x of costs){await c.query("UPDATE model_reservations SET state='settled',actual_tokens=$3,actual_calls=$4 WHERE run_id=$1 AND object_id=$2",[r.id,x.objectId,x.inputTokens+x.outputTokens,x.calls]);await recordUsage(c,{objectId:x.objectId,category:'model',businessKey:'model-receipt:'+r.id+':'+x.objectId,occurredAt:r.started_at.toISOString(),units:x.inputTokens+x.outputTokens,amount:x.amountCny,priceSource:evidence});}
 await c.query("UPDATE assistant_runs SET state=CASE WHEN state='result_unknown' THEN 'resolved_without_answer' ELSE state END WHERE id=$1",[r.id]);
 await c.query("UPDATE jobs SET state='done',finished_at=now(),error_code='RECEIPT_CONFIRMED' WHERE business_key=$1 AND state='awaiting_receipt'",['assistant:'+r.id]);return {id:r.id,state:'receipt_confirmed',message:'账单已核实；没有补造模型答案，也不会自动重发'};
}
