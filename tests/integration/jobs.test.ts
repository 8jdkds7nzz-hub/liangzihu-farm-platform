import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withDb } from '../support/db';
import { transaction } from '../../src/db/pool';
import { enqueue,claimJob,finishJob,markExternalCall,recoverExpired,consumeOnce } from '../../src/modules/jobs/repository';

test('并发领取只有一个有效租约；旧令牌与过期租约不能完成任务',async()=>withDb(async pool=>{
  const at=new Date();const id=await transaction(c=>enqueue(c,{kind:'test',businessKey:'one',payload:{n:1},dueAt:at.toISOString()}),pool);
  const leases=await Promise.all([claimJob(pool,'w1',at),claimJob(pool,'w2',at)]);const lease=leases.find(Boolean)!;
  assert.equal(leases.filter(Boolean).length,1);
  assert.equal(await finishJob(pool,id,randomUUID(),{state:'done'},at),false);
  const later=new Date(at.getTime()+60_001);assert.equal(await finishJob(pool,id,lease.leaseToken,{state:'done'},later),false);
  await recoverExpired(pool,later);const newLease=await claimJob(pool,'w3',later);assert(newLease);
  assert.notEqual(newLease.leaseToken,lease.leaseToken);assert.equal(await finishJob(pool,id,newLease.leaseToken,{state:'done'},later),true);
}));
test('外部调用已开始但结果丢失，恢复后等待核实而不重发',async()=>withDb(async pool=>{
  const at=new Date();const id=await transaction(c=>enqueue(c,{kind:'phone',businessKey:'phone-once',payload:{},dueAt:at.toISOString()}),pool);
  const lease=await claimJob(pool,'w1',at);assert(lease);
  assert.equal(await markExternalCall(pool,id,lease.leaseToken,at),true);
  const later=new Date(at.getTime()+61_000);await recoverExpired(pool,later);
  assert.equal(await claimJob(pool,'w2',later),null);
  assert.equal((await pool.query('SELECT state FROM jobs WHERE id=$1',[id])).rows[0].state,'awaiting_receipt');
}));
test('工作登记与业务事务共同回滚；同键内容不同拒绝；重复事件只执行一次',async()=>withDb(async pool=>{
  const at=new Date().toISOString();await assert.rejects(()=>transaction(async c=>{await enqueue(c,{kind:'test',businessKey:'rollback',payload:{},dueAt:at});throw Error('rollback');},pool));
  assert.equal(Number((await pool.query('SELECT count(*) FROM jobs')).rows[0].count),0);
  await transaction(c=>enqueue(c,{kind:'test',businessKey:'unique',payload:{a:1},dueAt:at}),pool);
  await assert.rejects(()=>transaction(c=>enqueue(c,{kind:'test',businessKey:'unique',payload:{a:2},dueAt:at}),pool),{status:409});
  const eventId=(await pool.query("INSERT INTO domain_events(event_type,payload) VALUES('test','{}') RETURNING id")).rows[0].id;let count=0;
  for(let i=0;i<2;i++)await transaction(c=>consumeOnce(c,'test-consumer',eventId,async()=>{count++;}),pool);
  assert.equal(count,1);
}));
