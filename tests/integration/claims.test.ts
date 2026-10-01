import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withDb } from '../support/db';
import { telemetryFixture } from '../support/telemetry';
import { actorFixture,permit } from '../support/fixtures';
import { transaction } from '../../src/db/pool';
import { createRule,approveRule,enableRule } from '../../src/modules/alerts/rules';
import { evaluateObservation,scanMonitoringGaps } from '../../src/modules/alerts/service';
import { claimAlert,appendAlertEvent,closeAlert } from '../../src/modules/alerts/claims';
import { saveBatch } from '../../src/modules/registry/batches';
import { archiveReceipt,ingest } from '../../src/modules/telemetry/ingest';

test('规则必须先审核；新有效样本开警、重复消费不重开；核查与排障分别并发认领，恢复不自动关闭',async()=>withDb(async pool=>{
  const f=await telemetryFixture(pool);
  const rule=await transaction(async c=>{
    const batch=await saveBatch(c,f.actor,{objectId:f.objectId,code:'RULE-SYNTH',species:'合成物种',stage:'合成阶段',source:'合成测试',verified:true,startedAt:'2026-09-01T00:00:00Z'});
    const rule=await createRule(c,f.actor,{objectId:f.objectId,pointId:f.point.id,batchId:batch.id,name:'合成阈值规则',comparison:'lt',threshold:5,durationMs:0,maxGapMs:30_000,maxAgeMs:60_000,severity:'severe',source:'仅合成规则，不适用于农场',effectiveFrom:'2026-09-01T00:00:00Z'},f.at);
    await assert.rejects(()=>enableRule(c,f.actor,rule.id,true,f.at),{code:'APPROVAL_REQUIRED'});
    await approveRule(c,f.actor,rule.id,'合成规则审核测试',f.at);await enableRule(c,f.actor,rule.id,true,f.at);return rule;
  },pool);
  async function sample(value:number,seconds:number){return transaction(async c=>{
    const at=new Date(f.at.getTime()+seconds*1000),rawRef=await archiveReceipt(c,f.source.id,Buffer.from('{}'),at.toISOString(),true);
    const result=await ingest(c,{...f.reading,rawRef,sourceRecordId:'r'+seconds,value,rawValue:value,sampledAt:at.toISOString(),receivedAt:at.toISOString()},at);
    const event=(await c.query("SELECT id FROM domain_events WHERE event_type='reading.recorded' AND payload->>'observationId'=$1",[result.observationId])).rows[0];
    await evaluateObservation(c,event.id,result.observationId!,at);await evaluateObservation(c,event.id,result.observationId!,at);return result;
  },pool);}
  await sample(1,0);const alert=(await pool.query("SELECT * FROM alerts WHERE kind='measurement'")).rows[0];assert(alert);
  assert.equal(Number((await pool.query("SELECT count(*) FROM alerts WHERE kind='measurement'")).rows[0].count),1);
  const w1=await actorFixture(pool,'worker'),w2=await actorFixture(pool,'worker'),repair=await actorFixture(pool,'maintainer');
  for(const a of [w1,w2,repair])await permit(pool,a.id,f.objectId,['read','claim','record','close_alert']);
  const key=randomUUID(),results=await Promise.allSettled([transaction(c=>claimAlert(c,w1,alert.id,'field_check',key),pool),transaction(c=>claimAlert(c,w2,alert.id,'field_check',randomUUID()),pool)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const claimed=(await pool.query("SELECT actor_id,request_key FROM alert_claims WHERE purpose='field_check'")).rows[0],winner=claimed.actor_id===w1.id?w1:w2;
  const duplicate=await transaction(c=>claimAlert(c,winner,alert.id,'field_check',claimed.request_key),pool);assert.equal(duplicate.actor_id,winner.id);
  await transaction(c=>claimAlert(c,repair,alert.id,'repair',randomUUID()),pool);
  const field=await transaction(c=>appendAlertEvent(c,winner,alert.id,{type:'field_check',note:'合成现场核查',requestKey:randomUUID()}),pool);
  const fix=await transaction(c=>appendAlertEvent(c,repair,alert.id,{type:'repair',note:'合成处置记录',requestKey:randomUUID()}),pool);
  const closure={fieldCheckId:field.id,repairId:fix.id,classification:'normal',requestKey:randomUUID()};
  await assert.rejects(()=>transaction(c=>closeAlert(c,winner,alert.id,closure),pool),{code:'NOT_RECOVERED'});
  await sample(10,10);assert.equal((await pool.query('SELECT state FROM alerts WHERE id=$1',[alert.id])).rows[0].state,'recovered');
  assert.equal((await transaction(c=>closeAlert(c,winner,alert.id,closure),pool)).state,'closed');
  assert.equal((await transaction(c=>closeAlert(c,winner,alert.id,closure),pool)).state,'closed');
  await transaction(c=>scanMonitoringGaps(c,new Date(f.at.getTime()+120_000)),pool);
  assert.equal(Number((await pool.query("SELECT count(*) FROM alerts WHERE kind='monitoring_gap' AND state='open'")).rows[0].count),1);
  assert.equal(rule.version,1);
}));
