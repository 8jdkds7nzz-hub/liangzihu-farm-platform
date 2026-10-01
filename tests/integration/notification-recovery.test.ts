import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { withDb } from '../support/db';
import { actorFixture,objectFixture,permit } from '../support/fixtures';
import { transaction } from '../../src/db/pool';
import { ensureAlert } from '../../src/modules/alerts/service';
import { claimAlert } from '../../src/modules/alerts/claims';
import { saveRoster } from '../../src/modules/notifications/rosters';
import { createIntent,planNotifications,dispatchNotice,queryReceipt } from '../../src/modules/notifications/service';
import { saveBudget,recordUsage } from '../../src/modules/operations/budget';
import { scheduleEscalation } from '../../src/modules/notifications/escalation';
import { claimJob,finishJob,recoverExpired } from '../../src/modules/jobs/repository';
import { encryptSecret } from '../../src/modules/identity/mfa';
import type { NotificationProvider,Notice } from '../../src/modules/notifications/types';
import type { Pool } from 'pg';
import { runNotificationCycle } from '../../src/modules/notifications/runner';

async function setup(pool:Pool){
  const tech=await actorFixture(pool,'technician'),onsite=await actorFixture(pool,'worker'),owner=await actorFixture(pool,'owner'),objectId=await objectFixture(pool,tech.id);
  for(const actor of [tech,onsite,owner])await permit(pool,actor.id,objectId,['read','claim','record']);await permit(pool,tech.id,objectId,['configure']);
  const at=new Date('2026-10-01T00:00:00Z'),key=randomBytes(32).toString('hex');
  for(const user of [tech,onsite,owner])for(const channel of ['wecom','voice'])await pool.query('INSERT INTO notification_contacts(user_id,channel,encrypted_address,verified,evidence,updated_by) VALUES($1,$2,$3,true,$4,$5)',[user.id,channel,encryptSecret('synthetic-not-a-real-address',user.id+':'+channel,key),'仅替身服务，不联系真实人员',tech.id]);
  const state=await transaction(async c=>{
    const roster=await saveRoster(c,tech,{objectId,startsAt:'2026-09-30T23:00:00Z',endsAt:'2026-10-01T12:00:00Z',nightShift:true,onsiteId:onsite.id,technicianId:tech.id,ownerId:owner.id,maintainerId:tech.id,callTimeoutMs:30_000,verified:true,evidence:'合成值班与等待时限，仅测试'});
    const alert=await ensureAlert(c,{objectId,key:'SYNTHETIC-ALERT',kind:'measurement',title:'合成告警',severity:'severe',quality:'valid'},at);
    const event=(await c.query("SELECT id FROM domain_events WHERE event_type='alert.opened'")).rows[0];
    await planNotifications(c,alert.id,event.id,'opened',at);return {roster,alert};
  },pool);
  return {tech,onsite,owner,objectId,at,...state};
}
async function sendQueued(pool:Pool,provider:NotificationProvider,at:Date){
  for(let n=0;n<20;n++){const job=await claimJob(pool,'synthetic-notifier',at,{kinds:['notice.send']});if(!job)break;const state=await dispatchNotice(pool,job,provider,at);await finishJob(pool,job.id,job.leaseToken,{state:state==='unknown'?'awaiting_receipt':'done'},at);}
}
test('三分钟后顺序升级；受理丢失不重发；接通不是认领；全程只调用替身',async()=>withDb(async pool=>{
  const f=await setup(pool),sent:Notice[]=[];let queries=0;
  const provider:NotificationProvider={send:async notice=>{sent.push(notice);if(notice.requestKey.startsWith('phone:')&&notice.recipientId===f.onsite.id)throw Error('模拟受理后本地丢回执');return {state:'accepted',providerRequestId:'synthetic-'+notice.id,occurredAt:f.at.toISOString(),reason:null};},query:async id=>{queries++;return {state:'delivered',connected:true,providerRequestId:id,occurredAt:f.at.toISOString(),reason:null};}};
  await sendQueued(pool,provider,f.at);
  await transaction(c=>scheduleEscalation(c,f.alert.id,new Date(f.at.getTime()+179_999)),pool);
  assert.equal(Number((await pool.query("SELECT count(*) FROM notification_intents WHERE channel='voice'")).rows[0].count),0);
  const due=new Date(f.at.getTime()+180_000);await transaction(c=>scheduleEscalation(c,f.alert.id,due),pool);await sendQueued(pool,provider,due);
  const first=(await pool.query("SELECT * FROM notification_intents WHERE channel='voice' AND level=0")).rows[0];assert.equal(first.state,'unknown');
  await queryReceipt(pool,first.id,provider);assert.equal(queries,0);
  await recoverExpired(pool,new Date(due.getTime()+61_000));assert.equal(await claimJob(pool,'retry',new Date(due.getTime()+61_000),{kinds:['notice.send']}),null);
  const next=new Date(due.getTime()+30_000);await transaction(c=>scheduleEscalation(c,f.alert.id,next),pool);await sendQueued(pool,provider,next);
  const second=(await pool.query("SELECT * FROM notification_intents WHERE channel='voice' AND level=1")).rows[0];await queryReceipt(pool,second.id,provider,next);
  assert.equal(Number((await pool.query('SELECT count(*) FROM alert_claims')).rows[0].count),0);
  await transaction(c=>scheduleEscalation(c,f.alert.id,new Date(next.getTime()+30_000)),pool);
  assert.deepEqual((await pool.query("SELECT recipient_id FROM notification_intents WHERE channel='voice' ORDER BY level")).rows.map(r=>r.recipient_id),[f.onsite.id,f.tech.id,f.owner.id]);
  assert.equal(sent.filter(n=>n.requestKey.startsWith('phone:')&&n.recipientId===f.onsite.id).length,1);
  assert.equal((await pool.query('SELECT first_notification_at FROM alerts WHERE id=$1',[f.alert.id])).rows[0].first_notification_at.toISOString(),f.at.toISOString());
}));
test('认领后已排队电话也取消；撤权后消息不发；两次发送同租约只执行一次',async()=>withDb(async pool=>{
  const f=await setup(pool);let count=0;const provider:NotificationProvider={send:async notice=>{count++;return {state:'delivered',providerRequestId:notice.id,occurredAt:f.at.toISOString(),reason:null};},query:async()=>{throw Error('not needed');}};
  const job=await claimJob(pool,'n',f.at,{kinds:['notice.send']});assert(job);
  await Promise.all([dispatchNotice(pool,job,provider,f.at),dispatchNotice(pool,job,provider,f.at)]);assert.equal(count,1);await finishJob(pool,job.id,job.leaseToken,{state:'done'},f.at);
  await sendQueued(pool,provider,f.at);const before=count,due=new Date(f.at.getTime()+180_000);
  await transaction(c=>scheduleEscalation(c,f.alert.id,due),pool);
  await transaction(c=>claimAlert(c,f.onsite,f.alert.id,'field_check',randomUUID(),due),pool);
  await sendQueued(pool,provider,due);assert.equal(count,before);
  assert.equal((await pool.query("SELECT state FROM notification_intents WHERE channel='voice'")).rows[0].state,'cancelled');
  await transaction(c=>scheduleEscalation(c,f.alert.id,new Date(due.getTime()+60_000)),pool);
  assert.equal(Number((await pool.query("SELECT count(*) FROM notification_intents WHERE channel='voice'")).rows[0].count),1);
  await transaction(c=>createIntent(c,{alertId:f.alert.id,rosterId:f.roster.id,recipientId:f.owner.id,channel:'wecom',phase:'initial',requestKey:'revocation-test',text:'合成撤权测试'},due),pool);
  await pool.query("UPDATE grants SET revoked_at=now() WHERE user_id=$1 AND action='read'",[f.owner.id]);
  await sendQueued(pool,provider,due);assert.equal(count,before);
}));

test('预算超限不阻断严重电话；全部失败后合并提醒至少隔5分钟；停用人员不占据认领',async()=>withDb(async pool=>{
  const f=await setup(pool),admin=await actorFixture(pool);await permit(pool,admin.id,f.objectId,['read']);
  await transaction(async c=>{await saveBudget(c,f.tech,{objectId:f.objectId,category:'voice',month:'2026-10-01',limitAmount:1,source:'合成预算'});await recordUsage(c,{objectId:f.objectId,category:'voice',businessKey:'over-budget-test',occurredAt:f.at.toISOString(),units:1,amount:2,priceSource:'合成账单'});},pool);
  let phones=0;const provider:NotificationProvider={send:async n=>{const phone=n.requestKey.startsWith('phone:');if(phone)phones++;return {state:phone?'failed':'accepted',providerRequestId:n.id,occurredAt:f.at.toISOString(),reason:null};},query:async()=>{throw Error('unused');}};
  await sendQueued(pool,provider,f.at);await transaction(c=>claimAlert(c,f.onsite,f.alert.id,'field_check',randomUUID(),f.at),pool);
  await pool.query('UPDATE users SET enabled=false WHERE id=$1',[f.onsite.id]);
  const due=new Date(f.at.getTime()+180_000);
  for(let i=0;i<4;i++){await transaction(c=>scheduleEscalation(c,f.alert.id,due),pool);await sendQueued(pool,provider,due);}
  // Disabled onsite recipient is cancelled; the two remaining authorized recipients are attempted once.
  assert.equal(phones,2);assert.equal(Number((await pool.query("SELECT count(*) FROM alert_claims WHERE ended_at IS NULL")).rows[0].count),0);
  const count=Number((await pool.query("SELECT count(*) FROM notification_intents WHERE phase IN ('reminder','admin_reminder')")).rows[0].count);
  await transaction(c=>scheduleEscalation(c,f.alert.id,new Date(due.getTime()+299_999)),pool);assert.equal(Number((await pool.query("SELECT count(*) FROM notification_intents WHERE phase IN ('reminder','admin_reminder')")).rows[0].count),count);
  await transaction(c=>scheduleEscalation(c,f.alert.id,new Date(due.getTime()+300_000)),pool);assert(Number((await pool.query("SELECT count(*) FROM notification_intents WHERE phase IN ('reminder','admin_reminder')")).rows[0].count)>count);
}));
test('完整通知执行循环自动消费受理后的查询任务，不把查询未知当作重新发送',async()=>withDb(async pool=>{
  const f=await setup(pool);let sent=0,queried=0;
  const provider:NotificationProvider={send:async n=>{sent++;return {state:'accepted',providerRequestId:n.id,occurredAt:f.at.toISOString(),reason:null};},query:async id=>{queried++;return {state:'delivered',providerRequestId:id,occurredAt:f.at.toISOString(),reason:null};}};
  for(let i=0;i<10;i++)await runNotificationCycle(pool,'synthetic-full-cycle',{wecom:provider,voice:provider},{now:()=>f.at});
  assert.equal(sent,2);assert.equal(queried,2);assert.equal(Number((await pool.query("SELECT count(*) FROM notification_intents WHERE state='delivered'")).rows[0].count),2);
}));
