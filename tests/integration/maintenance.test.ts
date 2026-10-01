import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { withDb } from '../support/db';
import { telemetryFixture } from '../support/telemetry';
import { actorFixture,permit } from '../support/fixtures';
import { transaction } from '../../src/db/pool';
import { recordMaintenance,recordManualCheck } from '../../src/modules/maintenance/records';
import { createExport,downloadExport } from '../../src/modules/maintenance/exports';
import { getPointHistory } from '../../src/modules/telemetry/queries';
import { archiveReceipt,ingest } from '../../src/modules/telemetry/ingest';
import { createWorkOrder,updateWorkOrder } from '../../src/modules/maintenance/work-orders';
test('维护与复测更正留链，复测不覆盖在线值，曲线同时包含维护及复测',async()=>withDb(async pool=>{
  const f=await telemetryFixture(pool);
  await transaction(async c=>{
    const rawRef=await archiveReceipt(c,f.source.id,Buffer.from('{}'),f.at.toISOString(),true);await ingest(c,{...f.reading,rawRef},f.at);
    const base={objectId:f.objectId,pointId:f.point.id,occurredAt:f.reading.sampledAt,recordType:'calibration',description:'合成校准',parameter:'测试参数',before:'0',after:'1',unit:'test_unit',source:'合成练习记录，非现场',requestKey:randomUUID()};
    const first=await recordMaintenance(c,f.actor,base);assert.equal((await recordMaintenance(c,f.actor,base)).id,first.id);
    await recordMaintenance(c,f.actor,{...base,after:'2',supersedesId:first.id,requestKey:randomUUID()});
    assert.equal((await c.query('SELECT payload FROM maintenance_records WHERE id=$1',[first.id])).rows[0].payload.after,'1');
    const manual={objectId:f.objectId,pointId:f.point.id,occurredAt:f.reading.sampledAt,metric:'synthetic_metric',rawValue:'8.00',value:8,unit:'test_unit',method:'合成手持仪',source:'练习',requestKey:randomUUID()};
    const old=await recordManualCheck(c,f.actor,manual);await recordManualCheck(c,f.actor,{...manual,value:9,rawValue:'9.00',supersedesId:old.id,requestKey:randomUUID()});
    assert.equal((await c.query('SELECT o.value::float8 AS value FROM point_current p JOIN observations o ON o.id=p.observation_id')).rows[0].value,0);
    const history=await getPointHistory(c,f.actor,f.point.id,{from:'2026-09-30T23:00:00Z',to:'2026-10-01T01:00:00Z'},f.at);assert.equal(history.maintenance.length,2);assert.equal(history.manualChecks.length,2);
  },pool);
  await assert.rejects(()=>pool.query("UPDATE maintenance_records SET source='覆盖'"),{code:'55000'});
}));
test('受控JSON导出保留关系、哈希匹配，撤权或其他账号不能下载旧文件',async()=>withDb(async pool=>{
  const f=await telemetryFixture(pool),other=await actorFixture(pool,'expert');
  const task=await transaction(c=>createExport(c,f.actor,{objectId:f.objectId,from:'2026-09-30T00:00:00Z',to:'2026-10-02T00:00:00Z'}),pool);
  const file=await transaction(c=>downloadExport(c,f.actor,task.id),pool);assert.equal(createHash('sha256').update(file.body).digest('hex'),file.sha256);
  const parsed=JSON.parse(file.body);assert.equal(parsed.schemaVersion,'1c-v1');assert.equal(parsed.objects[0].id,f.objectId);assert.equal(parsed.bindings[0].point_id,f.point.id);
  await assert.rejects(()=>transaction(c=>downloadExport(c,other,task.id),pool),{status:404});
  await pool.query("UPDATE grants SET revoked_at=now() WHERE user_id=$1 AND action='export'",[f.actor.id]);
  await assert.rejects(()=>transaction(c=>downloadExport(c,f.actor,task.id),pool),{status:403});
  await assert.rejects(()=>transaction(c=>createExport(c,other,{objectId:f.objectId,from:'2026-09-30T00:00:00Z',to:'2026-10-02T00:00:00Z'}),pool),{status:403});
}));
test('工单不自动派发；仅授权派单，指定人员处理，专业人员复核',async()=>withDb(async pool=>{
  const f=await telemetryFixture(pool),repair=await actorFixture(pool,'maintainer');await permit(pool,f.actor.id,f.objectId,['dispatch']);await permit(pool,repair.id,f.objectId,['read','record']);
  await transaction(async c=>{
    const order=await createWorkOrder(c,f.actor,{objectId:f.objectId,fault:'合成故障',responsibleRole:'maintainer',requestKey:randomUUID()});assert.equal(order.state,'open');assert.equal(order.assigned_to,null);
    await updateWorkOrder(c,f.actor,{id:order.id,state:'assigned',assignedTo:repair.id,note:'人工安排',requestKey:randomUUID()});
    await assert.rejects(()=>updateWorkOrder(c,f.actor,{id:order.id,state:'handled',note:'代替处理',requestKey:randomUUID()}),{status:403});
    const handled={id:order.id,state:'handled',note:'合成处理结果',requestKey:randomUUID()};await updateWorkOrder(c,repair,handled);await updateWorkOrder(c,repair,handled);
    await updateWorkOrder(c,f.actor,{id:order.id,state:'reviewed',note:'合成复核依据',requestKey:randomUUID()});
    assert.equal(Number((await c.query('SELECT count(*) FROM work_order_events WHERE work_order_id=$1',[order.id])).rows[0].count),4);
  },pool);
}));
