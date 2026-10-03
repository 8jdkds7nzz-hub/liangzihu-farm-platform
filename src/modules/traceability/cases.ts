import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';import {AppError} from '../../platform/error';
import {text,time,choice} from '../../platform/validation';import {uuid} from '../identity/common';import {scope} from '../field/common';
import {lot,request,type Body} from '../inventory/common';import {positive,micros,decimal,signedMicros} from '../inventory/quantity';
export async function openCase(c:PoolClient,a:Actor,b:Body){const l=await lot(c,a,b.lotId);return request(c,a,b,'quality.case',l.object_id,async()=>{
 await lot(c,a,l.id,'record',true);return(await c.query('INSERT INTO quality_cases(object_id,lot_id,title,target_quantity,evidence,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[l.object_id,l.id,text(b.title,'问题',200),positive(b.targetQuantity,l.unit),text(b.evidence,'问题依据',4000),a.id])).rows[0];});}
export async function caseStatus(c:PoolClient,id:string){
 const r=(await c.query('SELECT * FROM quality_cases WHERE id=$1',[id])).rows[0];if(!r)throw new AppError(404,'CASE_NOT_FOUND','问题记录不存在');
 const events=(await c.query('SELECT * FROM quality_case_events WHERE case_id=$1 ORDER BY created_at,id',[id])).rows;
 const sum=(action:string)=>events.filter(e=>e.action===action).reduce((n,e)=>n+signedMicros(e.quantity??'0'),0n),recovered=sum('recover'),disposed=sum('dispose');
 return {...r,events,notified:events.some(e=>e.action==='notice'),recovered:decimal(recovered),disposed:decimal(disposed),remaining:decimal(micros(r.target_quantity)-recovered)};
}
export async function caseEvent(c:PoolClient,a:Actor,b:Body){
 uuid(b.caseId);const old=(await c.query('SELECT * FROM quality_cases WHERE id=$1',[b.caseId])).rows[0];if(!old)throw new AppError(404,'CASE_NOT_FOUND','问题记录不存在');
 const l=await lot(c,a,old.lot_id),action=choice(b.action,['notice','recover','dispose','close'] as const,'处置动作');
 if(action==='close')await scope(c,a,l.object_id,'review');
 return request(c,a,b,'quality.case-event',l.object_id,async()=>{
 await lot(c,a,l.id,'record',true);await c.query('SELECT id FROM quality_cases WHERE id=$1 FOR UPDATE',[old.id]);const s=await caseStatus(c,old.id);
 if(s.state!=='open')throw new AppError(409,'CASE_CLOSED','案件已结案，不再追加处置动作');
 const q=['recover','dispose'].includes(action)?positive(b.quantity,l.unit):null;
 if(action==='recover'&&micros(s.recovered)+micros(q)>micros(s.target_quantity)||action==='dispose'&&micros(s.disposed)+micros(q)>micros(s.recovered))throw new AppError(422,'CASE_QUANTITY','追回或处置数量超过当前可处理数量');
 if(action==='close'&&(!s.notified||s.remaining!=='0'||s.disposed!==s.recovered))throw new AppError(409,'CASE_INCOMPLETE','通知、追回或处置尚未完成，不能结案');
 const at=time(b.occurredAt);if(new Date(at)<old.created_at)throw new AppError(422,'CASE_TIME','处置时刻须晚于案件登记');
 const r=(await c.query('INSERT INTO quality_case_events(object_id,case_id,action,quantity,occurred_at,evidence,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[l.object_id,old.id,action,q,at,text(b.evidence,'实际处置依据',4000),a.id])).rows[0];
 if(action==='close')await c.query("UPDATE quality_cases SET state='closed' WHERE id=$1",[old.id]);return r;
 });
}

