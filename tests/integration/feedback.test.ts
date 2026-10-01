import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withDb } from '../support/db';
import { actorFixture,objectFixture,permit } from '../support/fixtures';
import { transaction } from '../../src/db/pool';
import { createFeedback,listFeedback,updateFeedback } from '../../src/modules/operations/feedback';
test('反馈带页面时间、防重复、按对象可见，处理保留历史，撤权后不可再读',async()=>withDb(async pool=>{
  const admin=await actorFixture(pool),worker=await actorFixture(pool,'worker'),outsider=await actorFixture(pool,'worker'),objectId=await objectFixture(pool,admin.id);
  await permit(pool,admin.id,objectId,['read','configure']);await permit(pool,worker.id,objectId,['read']);
  const body={objectId,title:'合成界面问题',description:'合成复现步骤，不是真实员工信息',pagePath:'/alerts',requestKey:randomUUID()};
  const created=await transaction(c=>createFeedback(c,worker,body),pool);assert.equal((await transaction(c=>createFeedback(c,worker,body),pool)).id,created.id);
  assert.equal((await transaction(c=>listFeedback(c,outsider),pool)).items.length,0);
  await assert.rejects(()=>transaction(c=>updateFeedback(c,worker,{id:created.id,state:'resolved',note:'越权处理',requestKey:randomUUID()}),pool),{status:403});
  await transaction(c=>updateFeedback(c,admin,{id:created.id,state:'resolved',note:'合成验证修复并记录',requestKey:randomUUID()}),pool);
  const report=await transaction(c=>listFeedback(c,worker),pool);assert.equal(report.items[0].state,'resolved');assert.equal(report.events.length,2);assert.equal(report.items[0].page_path,'/alerts');
  await pool.query('UPDATE grants SET revoked_at=now() WHERE user_id=$1',[worker.id]);assert.equal((await transaction(c=>listFeedback(c,worker),pool)).items.length,0);
}));
