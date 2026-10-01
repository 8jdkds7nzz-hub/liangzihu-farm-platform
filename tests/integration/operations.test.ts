import test from 'node:test';
import assert from 'node:assert/strict';
import { withDb } from '../support/db';
import { actorFixture,objectFixture,permit } from '../support/fixtures';
import { transaction } from '../../src/db/pool';
import { saveBudget,recordUsage,listBudgets } from '../../src/modules/operations/budget';
import { heartbeat,readiness,CORE_SERVICES } from '../../src/modules/operations/heartbeat';
test('预算使用数据库精确金额，80%提示只登记一次，未知费用不伪造金额',async()=>withDb(async pool=>{
  const actor=await actorFixture(pool),objectId=await objectFixture(pool,actor.id);await permit(pool,actor.id,objectId,['configure']);
  await transaction(async c=>{
    await saveBudget(c,actor,{objectId,category:'voice',month:'2026-10-01',limitAmount:1,source:'合成预算，仅测试'});
    await recordUsage(c,{objectId,category:'voice',businessKey:'bill1',occurredAt:'2026-10-01T00:00:00Z',units:1,amount:0.1,priceSource:'合成账单'});
    await recordUsage(c,{objectId,category:'voice',businessKey:'bill2',occurredAt:'2026-10-01T00:00:00Z',units:1,amount:0.7,priceSource:'合成账单'});
    await recordUsage(c,{objectId,category:'voice',businessKey:'unknown',occurredAt:'2026-10-01T00:00:00Z',units:1,amount:null});
    const [status]=await listBudgets(c,actor);assert.equal(status.month,'2026-10-01');assert.equal(status.at_eighty,true);assert.equal(status.at_limit,false);assert.equal(status.unknown_cost_count,1);
    assert.equal(Number((await c.query('SELECT count(*) FROM budget_alerts')).rows[0].count),1);
    await assert.rejects(()=>recordUsage(c,{objectId,category:'voice',businessKey:'bill2',occurredAt:'2026-10-01T00:00:00Z',units:1,amount:1,priceSource:'更改'}),{code:'USAGE_CONFLICT'});
  },pool);
}));
test('健康检查同时要求核心进程成功处理和备份时效；活着但阻塞仍未就绪',async()=>withDb(async pool=>{
  const at=new Date();await transaction(async c=>{
    for(const service of CORE_SERVICES)await heartbeat(c,service,'synthetic-worker','ok',at,true);
    assert.equal((await readiness(c,at)).ready,false);
    await c.query("INSERT INTO backup_runs(started_at,completed_at,latest_recoverable_at,manifest_ref,checksum_passed,state,scope,evidence) VALUES($1,$1,$1,'synthetic',true,'verified',ARRAY['database'],'{\"database\":\"agri_test\"}')",[at]);
    assert.equal((await readiness(c,at)).ready,true);
    await heartbeat(c,'notifications','synthetic-worker','blocked',at,true,'PROVIDER_NOT_READY');assert.equal((await readiness(c,at)).ready,false);
    await heartbeat(c,'notifications','synthetic-worker','ok',at,true);
    assert.equal((await readiness(c,new Date(at.getTime()+61_000))).ready,false);
    const later=new Date(at.getTime()+901_000);for(const service of CORE_SERVICES)await heartbeat(c,service,'synthetic-worker','ok',later,true);
    assert.equal((await readiness(c,later)).backup.ready,false);
  },pool);
}));
