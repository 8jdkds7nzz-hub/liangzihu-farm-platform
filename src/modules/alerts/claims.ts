import type { PoolClient } from 'pg';
import type { Actor,ClaimPurpose,EvidenceRef } from '../../platform/types';
import { AppError } from '../../platform/error';
import { choice,text } from '../../platform/validation';
import { assertAccess } from '../identity/access';
import { denied,uuid } from '../identity/common';
import { writeApi } from '../../platform/api';

async function lockAlert(c:PoolClient,actor:Actor,id:string,action:'claim'|'record'|'review'|'close_alert'){
  uuid(id);const alert=(await c.query('SELECT * FROM alerts WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!alert)throw new AppError(404,'ALERT_NOT_FOUND','事件不存在');
  await assertAccess(c,actor,{objectId:alert.object_id,action,at:new Date().toISOString()});return alert;
}
export async function claimAlert(c:PoolClient,actor:Actor,id:string,purpose:ClaimPurpose,requestKey:string,at=new Date()){
  choice(purpose,['field_check','repair'] as const,'认领职责');text(requestKey,'请求标识',100);
  if((actor.role==='worker'&&purpose!=='field_check')||(actor.role==='maintainer'&&purpose!=='repair'))throw denied();
  const alert=await lockAlert(c,actor,id,'claim');
  const prior=(await c.query('SELECT * FROM alert_claims WHERE actor_id=$1 AND request_key=$2',[actor.id,requestKey])).rows[0];
  if(prior){if(prior.alert_id!==id||prior.purpose!==purpose)throw new AppError(409,'REQUEST_KEY_CONFLICT','请求标识已经用于其他认领');return prior;}
  if(alert.state==='closed')throw new AppError(409,'ALERT_CLOSED','事件已经关闭');
  const row=(await c.query(`INSERT INTO alert_claims(alert_id,purpose,actor_id,request_key,claimed_at) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(alert_id,purpose) WHERE ended_at IS NULL DO NOTHING RETURNING *`,[id,purpose,actor.id,requestKey,at])).rows[0];
  if(!row)throw new AppError(409,'ALREADY_CLAIMED','该职责已被认领，请刷新查看');
  if(purpose==='field_check')await c.query('UPDATE alerts SET unmanaged=false WHERE id=$1',[id]);
  await c.query("INSERT INTO alert_events(alert_id,event_type,actor_id,occurred_at,note) VALUES($1,'claimed',$2,$3,$4)",[id,actor.id,at,purpose==='field_check'?'认领现场核查':'认领排障']);return row;
}
async function validateEvidence(c:PoolClient,objectId:string,refs:unknown):Promise<EvidenceRef[]>{
  if(!Array.isArray(refs)||refs.length>20)throw new AppError(400,'INVALID_EVIDENCE','证据引用须为数组，最多20项');
  for(const ref of refs){if(!ref||typeof ref!=='object')throw new AppError(400,'INVALID_EVIDENCE','证据格式不正确');uuid(ref.id);
    let ok=false;
    if(ref.kind==='reading')ok=!!(await c.query('SELECT 1 FROM observations WHERE id=$1 AND object_id=$2',[ref.id,objectId])).rowCount;
    if(ref.kind==='raw')ok=!!(await c.query('SELECT 1 FROM observations WHERE raw_ref=$1 AND object_id=$2',[ref.id,objectId])).rowCount;
    if(ref.kind==='record')ok=!!(await c.query('SELECT 1 FROM alert_events e JOIN alerts a ON a.id=e.alert_id WHERE e.id=$1 AND a.object_id=$2',[ref.id,objectId])).rowCount;
    if(!ok)throw new AppError(422,'EVIDENCE_SCOPE','证据不存在、尚未支持或不属于该对象');
  }return refs;
}
export async function appendAlertEvent(c:PoolClient,actor:Actor,id:string,input:Record<string,unknown>,at=new Date()){
  const type=choice(input.type,['field_check','repair','note','classification'] as const,'记录类型');
  const alert=await lockAlert(c,actor,id,type==='classification'?'review':'record');
  const key=text(input.requestKey,'请求标识',100),note=text(input.note,'核查或处置说明',4000),evidence=await validateEvidence(c,alert.object_id,input.evidence??[]);
  const classification=type==='classification'?choice(input.classification,['normal','false_alarm','device_issue','unknown'] as const,'核查分类'):null;
  const prior=(await c.query('SELECT *,note=$3 AND evidence=$4::jsonb AND classification IS NOT DISTINCT FROM $5::text AS same FROM alert_events WHERE actor_id=$1 AND request_key=$2',[actor.id,key,note,JSON.stringify(evidence),classification])).rows[0];
  if(prior){if(prior.alert_id!==id||prior.event_type!==type||!prior.same)throw new AppError(409,'REQUEST_KEY_CONFLICT','同一标识的记录内容不同');return prior;}
  if(alert.state==='closed')throw new AppError(409,'ALERT_CLOSED','已关闭事件不能追加处置，请登记新事件');
  if(['field_check','repair'].includes(type)&&!(await c.query('SELECT 1 FROM alert_claims WHERE alert_id=$1 AND purpose=$2 AND actor_id=$3 AND ended_at IS NULL',[id,type,actor.id])).rowCount)throw new AppError(422,'CLAIM_REQUIRED','请先认领对应职责');
  return (await c.query('INSERT INTO alert_events(alert_id,event_type,actor_id,occurred_at,note,evidence,request_key,classification) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[id,type,actor.id,at,note,JSON.stringify(evidence),key,classification])).rows[0];
}
export async function closeAlert(c:PoolClient,actor:Actor,id:string,input:Record<string,unknown>,at=new Date()){
  const alert=await lockAlert(c,actor,id,'close_alert'),key=text(input.requestKey,'请求标识',100);uuid(input.fieldCheckId);uuid(input.repairId);
  const classification=choice(input.classification,['normal','false_alarm','device_issue'] as const,'关闭分类');
  const evidence=[{kind:'record',id:input.fieldCheckId},{kind:'record',id:input.repairId}];
  const existing=(await c.query('SELECT *,evidence=$3::jsonb AS same FROM alert_events WHERE actor_id=$1 AND request_key=$2',[actor.id,key,JSON.stringify(evidence)])).rows[0];
  if(existing){if(existing.event_type!=='closed'||existing.alert_id!==id||existing.classification!==classification||!existing.same)throw new AppError(409,'REQUEST_KEY_CONFLICT','关闭请求标识冲突');return {id,state:'closed'};}
  if(alert.state==='closed')throw new AppError(409,'ALERT_CLOSED','事件已经关闭');
  for(const [ref,type] of [[input.fieldCheckId,'field_check'],[input.repairId,'repair']])if(!(await c.query('SELECT 1 FROM alert_events WHERE id=$1 AND alert_id=$2 AND event_type=$3',[ref,id,type])).rowCount)throw new AppError(422,'CLOSURE_EVIDENCE_REQUIRED','关闭须引用本事件的核查和处置记录');
  if(alert.state!=='recovered'){
    const reviewed=(await c.query("SELECT classification FROM alert_events WHERE alert_id=$1 AND event_type='classification' ORDER BY recorded_at DESC LIMIT 1",[id])).rows[0];
    if(classification!=='false_alarm'||reviewed?.classification!=='false_alarm')throw new AppError(422,'NOT_RECOVERED','尚未恢复；误报须经专业审核后才能关闭');
  }
  await c.query("UPDATE alerts SET state='closed',closed_at=$2,unmanaged=false WHERE id=$1",[id,at]);await c.query('UPDATE alert_claims SET ended_at=$2 WHERE alert_id=$1 AND ended_at IS NULL',[id,at]);
  await c.query("INSERT INTO alert_events(alert_id,event_type,actor_id,occurred_at,note,evidence,request_key,classification) VALUES($1,'closed',$2,$3,$4,$5,$6,$7)",[id,actor.id,at,'引用核查与处置记录关闭',JSON.stringify(evidence),key,classification]);return {id,state:'closed'};
}
export function handleClaimRequest(request:Request,alertId:string){return writeApi(request,(c,a,b)=>claimAlert(c,a,alertId,choice(b.purpose,['field_check','repair'] as const,'职责'),text(b.requestKey,'请求标识',100)));}
