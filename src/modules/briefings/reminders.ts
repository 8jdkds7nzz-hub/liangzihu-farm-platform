import type {Pool,PoolClient} from 'pg';
import type {Actor} from '../../platform/types';
import {transaction} from '../../db/pool';
import {AppError} from '../../platform/error';
import {scope} from '../field/common';
import {enqueue,type JobLease} from '../jobs/repository';
import {assertLease,externalStarted,withLease} from '../jobs/execution';
import type {NotificationProvider,Receipt} from '../notifications/types';
import {wecomProvider} from '../notifications/wecom';
import {recordUsage} from '../operations/budget';
async function recipient(c:PoolClient,r:any){const u=(await c.query('SELECT role,enabled,auth_version FROM users WHERE id=$1',[r.recipient_id])).rows[0];if(!u?.enabled||r.auth_version!==u.auth_version||!['owner','technician'].includes(u.role))throw new AppError(403,'REMINDER_AUTH_CHANGED','提醒接收资格已变更');const a:Actor={id:r.recipient_id,role:u.role,enabled:true,mfaVerified:true},items=(await c.query('SELECT DISTINCT object_id FROM briefing_items WHERE briefing_id=$1',[r.briefing_id])).rows;for(const i of items){await scope(c,a,i.object_id,'read');await scope(c,a,i.object_id,'review');}return items.map(i=>i.object_id as string);}
export async function queueOverdueReminders(c:PoolClient){
 const pending=(await c.query("SELECT r.*,u.auth_version AS current_auth FROM briefing_reminders r JOIN users u ON u.id=r.recipient_id WHERE r.state='pending' FOR UPDATE OF r SKIP LOCKED")).rows;
 for(const r of pending){r.auth_version??=r.current_auth;try{await recipient(c,r);}catch{await c.query("UPDATE briefing_reminders SET state='blocked',error_code='REMINDER_AUTH_CHANGED' WHERE id=$1",[r.id]);continue;}await c.query('UPDATE briefing_reminders SET auth_version=$2 WHERE id=$1',[r.id,r.auth_version]);await enqueue(c,{kind:'briefing.notify',businessKey:'briefing-reminder:'+r.id,payload:{reminderId:r.id},dueAt:new Date().toISOString(),priority:60});}
 await c.query("UPDATE briefing_reminders r SET state='unknown',error_code='REMINDER_RESULT_UNKNOWN' FROM jobs j WHERE j.business_key='briefing-reminder:'||r.id::text AND r.state='sending' AND j.state='awaiting_receipt'");
 return pending.length;
}
export async function runReminder(pool:Pool,id:string,lease?:JobLease,sender?:NotificationProvider){
 return withLease(pool,'briefing-reminder:'+id,lease,async current=>{
  const prepared=await transaction(async c=>{await assertLease(c,current);const r=(await c.query("SELECT * FROM briefing_reminders WHERE id=$1 AND state='pending' FOR UPDATE",[id])).rows[0];if(!r)return null;const draft=(await c.query("SELECT 1 FROM briefing_items WHERE briefing_id=$1 AND decision='draft' LIMIT 1",[r.briefing_id])).rowCount;if(!draft){await c.query("UPDATE briefing_reminders SET state='cancelled' WHERE id=$1",[id]);return null;}let ids:string[];try{ids=await recipient(c,r);}catch{await c.query("UPDATE briefing_reminders SET state='blocked',error_code='REMINDER_AUTH_CHANGED' WHERE id=$1",[id]);return null;}if(!(await c.query("SELECT 1 FROM notification_contacts WHERE user_id=$1 AND channel='wecom' AND verified",[r.recipient_id])).rowCount){await c.query("UPDATE briefing_reminders SET state='blocked',error_code='CONTACT_NOT_READY' WHERE id=$1",[id]);return null;}return {r,ids};},pool);
  if(!prepared)return;const provider=sender??wecomProvider(pool);await provider.ready?.();await transaction(async c=>{await recipient(c,prepared.r);await externalStarted(c,current);await c.query("UPDATE briefing_reminders SET state='sending',attempt_started_at=now() WHERE id=$1",[id]);for(const objectId of prepared.ids)await recordUsage(c,{objectId,category:'wecom',businessKey:'briefing-reminder:'+id+':'+objectId,occurredAt:new Date().toISOString(),units:1,amount:null});},pool);
  let receipt:Receipt;try{receipt=await provider.send({id,requestKey:'briefing-reminder:'+id,recipientId:prepared.r.recipient_id,alertId:null,source:{kind:'briefing',id:prepared.r.briefing_id},text:'有逾期未审阅的程序简报，请核查待确认事项；详情 /briefings'});}catch{receipt={state:'unknown',providerRequestId:null,occurredAt:new Date().toISOString(),reason:'RECEIPT_UNKNOWN'};}
  if(!['accepted','delivered','failed','unknown'].includes(receipt.state))receipt={state:'unknown',providerRequestId:null,occurredAt:new Date().toISOString(),reason:'INVALID_RECEIPT'};
  await transaction(async c=>{await assertLease(c,current);try{await recipient(c,prepared.r);}catch{receipt={state:'unknown',providerRequestId:null,occurredAt:new Date().toISOString(),reason:'REMINDER_AUTH_CHANGED'};}await c.query('UPDATE briefing_reminders SET state=$2,receipt=$3,error_code=$4 WHERE id=$1',[id,receipt.state,JSON.stringify(receipt),receipt.state==='unknown'?'REMINDER_RESULT_UNKNOWN':null]);},pool);
  if(receipt.state==='unknown')throw new AppError(503,'REMINDER_RESULT_UNKNOWN','提醒结果未知，保留待核，不重复发送');
 });
}
