import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {withDb} from '../support/db';import {telemetryFixture} from '../support/telemetry';import {transaction} from '../../src/db/pool';
import {saveDefinition,reviewDefinition,calculateMetric} from '../../src/modules/analysis/service';import {saveSchedule,generateDue} from '../../src/modules/briefings/schedule';
import * as scheduling from '../../src/modules/briefings/schedule';
import {submitRecord} from '../../src/modules/records/service';
import {recordMaintenance,recordManualCheck} from '../../src/modules/maintenance/records';
import {createBriefing,remindOverdue} from '../../src/modules/briefings/service';
import {runReminder} from '../../src/modules/briefings/reminders';
import {actorFixture} from '../support/fixtures';
import {encryptSecret} from '../../src/modules/identity/mfa';
test('T06小时与日周月调度幂等；一个计算失败不阻止程序简报',()=>withDb(async pool=>{
 const f=await telemetryFixture(pool),at=new Date('2026-10-01T02:00:00Z');for(const name of ['正常定义','故障定义']){const d=await transaction(c=>saveDefinition(c,f.actor,{objectId:f.objectId,pointId:f.point.id,name,sourceRef:'合成调度',specification:{formula:'mean',inputUnit:'test_unit',unit:'test_unit',intervalMs:60000,maxGapMs:120000,minimumCoverage:.8,timezone:'UTC'}}),pool);await transaction(c=>reviewDefinition(c,f.actor,{id:d.id}),pool);}
 for(const period of ['daily','weekly','monthly'])await transaction(c=>saveSchedule(c,f.actor,{objectId:f.objectId,period,hour:0,minute:0,enabled:true,evidence:'合成调度'}),pool);
 const once=await Reflect.apply(generateDue,null,[pool,at]);assert.equal(once.length,3);assert.equal((await Reflect.apply(generateDue,null,[pool,at])).length,0);
 const calculations=(await pool.query('SELECT id,definition_id FROM analysis_calculations ORDER BY id')).rows;assert(calculations.length>=8);
 for(const r of calculations)await Reflect.get(scheduling,'runCalculation')(pool,r.id,undefined,async(c:any,a:any,b:any,now:any)=>{const d=(await c.query('SELECT name FROM metric_definitions WHERE id=$1',[b.definitionId])).rows[0];if(d.name==='故障定义')throw Error('模拟单定义数据库读取故障');return calculateMetric(c,a,b,now);});
 for(const id of once)await Reflect.get(scheduling,'runScheduledBriefing')(pool,id);
 assert.equal((await pool.query('SELECT count(*) FROM briefings')).rows[0].count,'3');assert(Number((await pool.query("SELECT count(*) FROM analysis_calculations WHERE state='failed'")).rows[0].count)>0);
 assert.equal((await pool.query("SELECT count(*) FROM briefing_items WHERE kind='calculation_gap'")).rows[0].count,'3');
}));
test('T06逾期待审提醒落持久任务，受理不伪装已送达，重复不重发',()=>withDb(async pool=>{
 const f=await telemetryFixture(pool),admin=await actorFixture(pool,'admin');await pool.query("INSERT INTO notification_contacts(user_id,channel,encrypted_address,verified,evidence,updated_by) VALUES($1,'wecom',$2,true,'仅测试联系人',$3)",[f.actor.id,encryptSecret('synthetic-user',f.actor.id+':wecom','af'.repeat(32)),admin.id]);
 const b=await transaction(c=>createBriefing(c,f.actor,{objectIds:[f.objectId],period:'daily',from:'2026-10-01T00:00:00Z',to:'2026-10-02T00:00:00Z',requestKey:randomUUID()}),pool);await pool.query("UPDATE briefings SET review_due_at=clock_timestamp()-interval '1 second' WHERE id=$1",[b.id]);await transaction(remindOverdue,pool);
 const r=(await pool.query('SELECT id FROM briefing_reminders WHERE briefing_id=$1',[b.id])).rows[0];assert.equal((await pool.query("SELECT count(*) FROM jobs WHERE kind='briefing.notify'")).rows[0].count,'1');let sent=0;const provider={send:async(n:any)=>{sent++;assert.equal(n.alertId,null);return {state:'accepted' as const,providerRequestId:'synthetic-receipt',occurredAt:new Date().toISOString(),reason:null};},query:async()=>({state:'unknown' as const,providerRequestId:null,occurredAt:new Date().toISOString(),reason:null})};await runReminder(pool,r.id,undefined,provider);await runReminder(pool,r.id,undefined,provider);assert.equal(sent,1);assert.equal((await pool.query('SELECT state FROM briefing_reminders WHERE id=$1',[r.id])).rows[0].state,'accepted');
}));
test('T06并列农事/维护/复测，保留有效零和来源，不自动归因',()=>withDb(async pool=>{
 const f=await telemetryFixture(pool),at='2026-10-01T01:00:00Z';await transaction(c=>submitRecord(c,f.actor,{objectId:f.objectId,objectVersion:1,submissionId:randomUUID(),kind:'feeding',occurredAt:at,content:{observation:'合成未投喂核查',material:'合成饲料',amount:0,unit:'kg'},attachmentIds:[]}),pool);
 await transaction(c=>recordMaintenance(c,f.actor,{objectId:f.objectId,occurredAt:at,recordType:'calibration',description:'合成校准',parameter:'零点',before:'1',after:'0',unit:'test_unit',source:'合成台账',requestKey:randomUUID()}),pool);
 await transaction(c=>recordManualCheck(c,f.actor,{objectId:f.objectId,occurredAt:at,metric:'合成指标',rawValue:0,value:0,unit:'test_unit',method:'合成手持仪',source:'合成台账',requestKey:randomUUID()}),pool);
 const b=await transaction(c=>createBriefing(c,f.actor,{objectIds:[f.objectId],period:'daily',from:'2026-10-01T00:00:00Z',to:'2026-10-02T00:00:00Z',requestKey:randomUUID()}),pool),items=(await pool.query('SELECT * FROM briefing_items WHERE briefing_id=$1',[b.id])).rows;
 assert(items.some(i=>i.kind==='farm_record'&&i.original_text.includes('0 kg')));assert(items.some(i=>i.kind==='maintenance'));assert(items.some(i=>i.kind==='manual_check'&&i.original_text.includes('0 test_unit')));assert(items.filter(i=>['farm_record','maintenance','manual_check'].includes(i.kind)).every(i=>i.fact_refs.length===1&&i.limitations.length));
}));
