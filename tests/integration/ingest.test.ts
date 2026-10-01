import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withDb } from '../support/db';
import { telemetryFixture } from '../support/telemetry';
import { actorFixture,objectFixture,permit } from '../support/fixtures';
import { transaction } from '../../src/db/pool';
import { archiveReceipt,ingest,persistBatch } from '../../src/modules/telemetry/ingest';
import { getPointHistory } from '../../src/modules/telemetry/queries';

test('并发重放只计一次；有效零保留、原值不可更新、冲突同时保留并降低当前质量',async()=>withDb(async pool=>{
  const f=await telemetryFixture(pool);
  const rawRef=await transaction(c=>archiveReceipt(c,f.source.id,Buffer.from('{"synthetic":true}'),f.at.toISOString(),true),pool);
  const input={...f.reading,rawRef};const results=await Promise.all([transaction(c=>ingest(c,input,f.at),pool),transaction(c=>ingest(c,input,f.at),pool)]);
  assert.deepEqual(results.map(x=>x.disposition).sort(),['duplicate','inserted']);
  assert.equal((await pool.query('SELECT value::float8 AS value FROM observations')).rows[0].value,0);
  await assert.rejects(()=>pool.query('UPDATE observations SET value=1'),{code:'55000'});
  const conflict=await transaction(c=>ingest(c,{...input,rawValue:1,value:1},f.at),pool);assert.equal(conflict.disposition,'conflict');
  assert.equal(Number((await pool.query('SELECT count(*) FROM observations')).rows[0].count),2);
  assert.equal((await pool.query('SELECT quality FROM point_current')).rows[0].quality,'suspect');
  assert.equal(Number((await pool.query('SELECT count(*) FROM measurement_conflicts')).rows[0].count),1);
}));
test('旧数据、无身份、未核实映射与无效零不能成为当前有效值',async()=>withDb(async pool=>{
  const f=await telemetryFixture(pool),rawRef=await transaction(c=>archiveReceipt(c,f.source.id,Buffer.from('{}'),f.at.toISOString(),true),pool);
  await transaction(async c=>{
    assert.equal((await ingest(c,{...f.reading,rawRef,sourceRecordId:null,sampledAt:null},f.at)).disposition,'quarantined');
    assert.equal((await ingest(c,{...f.reading,rawRef,mappingVersion:randomUUID()},f.at)).disposition,'quarantined');
    assert.equal((await ingest(c,{...f.reading,rawRef,sourceRecordId:'offline',value:null,quality:'invalid',reasons:['offline']},f.at)).eligibleForCurrent,false);
    assert.equal((await ingest(c,{...f.reading,rawRef,sourceRecordId:'old',sampledAt:'2026-09-30T23:00:00Z',origin:'history'},f.at)).eligibleForCurrent,false);
  },pool);
  assert.equal(Number((await pool.query('SELECT count(*) FROM point_current')).rows[0].count),0);
}));
test('批量持久化失败不推进游标、不遗留报文/事件；成功后游标比较防覆盖',async()=>withDb(async pool=>{
  const f=await telemetryFixture(pool);const batch={sourceId:f.source.id,raw:Buffer.from('{}'),receivedAt:f.at.toISOString(),synthetic:true,expectedCursor:null,nextCursor:'c1',readings:[f.reading]};
  await assert.rejects(()=>persistBatch(pool,{...batch,readings:[f.reading,{...f.reading,sourceId:randomUUID()}]},f.at),{code:'SOURCE_MISMATCH'});
  for(const table of ['raw_receipts','observations','ingestion_cursors','domain_events','jobs'])assert.equal(Number((await pool.query('SELECT count(*) FROM '+table)).rows[0].count),0);
  assert.equal((await persistBatch(pool,batch,f.at))[0].disposition,'inserted');
  await assert.rejects(()=>persistBatch(pool,batch,f.at),{code:'CURSOR_CHANGED'});
}));
test('历史和当前接口按数据所属对象授权；数据新鲜度与通信分开，分页不补零',async()=>withDb(async pool=>{
  const f=await telemetryFixture(pool),other=await actorFixture(pool,'worker');const foreign=await objectFixture(pool,other.id);await permit(pool,other.id,foreign,['read']);
  await persistBatch(pool,{sourceId:f.source.id,raw:Buffer.from('{}'),receivedAt:f.at.toISOString(),synthetic:true,expectedCursor:null,nextCursor:'c1',readings:[f.reading]},f.at);
  const query={from:'2026-09-30T23:00:00Z',to:'2026-10-01T01:00:00Z'};
  const result=await transaction(c=>getPointHistory(c,f.actor,f.point.id,query,new Date(f.at.getTime()+120_000)),pool);
  assert.equal(result.items.length,1);assert.equal(result.dataState,'stale');assert.equal(result.communication.state,'last_contact_succeeded');assert.equal(result.items[0].value,0);
  await assert.rejects(()=>transaction(c=>getPointHistory(c,other,f.point.id,query),pool),{status:403});
  await pool.query('UPDATE grants SET revoked_at=now() WHERE user_id=$1',[f.actor.id]);
  await assert.rejects(()=>transaction(c=>getPointHistory(c,f.actor,f.point.id,query),pool),{status:403});
}));
