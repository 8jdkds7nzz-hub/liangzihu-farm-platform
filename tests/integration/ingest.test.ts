import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withDb } from '../support/db';
import { telemetryFixture } from '../support/telemetry';
import { actorFixture,objectFixture,permit } from '../support/fixtures';
import { transaction } from '../../src/db/pool';
import { archiveReceipt,ingest,persistBatch } from '../../src/modules/telemetry/ingest';
import { getPointHistory } from '../../src/modules/telemetry/queries';
import { bindPoint } from '../../src/modules/registry/points';

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
test('嵌套及转义的凭据字段也不进入原始报文库',async()=>withDb(async pool=>{
  const f=await telemetryFixture(pool);
  for(const body of ['{"data":{"client_secret":"synthetic"}}','{"\\u0061ccess_token":"synthetic"}','Authorization: Bearer synthetic'])await assert.rejects(()=>transaction(c=>archiveReceipt(c,f.source.id,Buffer.from(body),f.at.toISOString(),true),pool),{code:'CREDENTIAL_IN_PAYLOAD'});
  assert.equal(Number((await pool.query('SELECT count(*) FROM raw_receipts')).rows[0].count),0);
}));

test('换塘后旧对象仅保留历史，当前值不能沿用前一绑定或跨对象泄露',async()=>withDb(async pool=>{
  const f=await telemetryFixture(pool),oldViewer=await actorFixture(pool,'expert'),newObject=await objectFixture(pool,f.actor.id);
  await permit(pool,oldViewer.id,f.objectId,['read']);await permit(pool,f.actor.id,newObject,['read','configure']);
  await transaction(async c=>{
    const rawRef=await archiveReceipt(c,f.source.id,Buffer.from('{}'),f.at.toISOString(),true);await ingest(c,{...f.reading,rawRef},f.at);
    const moved=await bindPoint(c,f.actor,{pointId:f.point.id,objectId:newObject,validFrom:'2026-10-01T00:00:01Z',endPrevious:true,verified:true,evidence:'合成换塘'});
    const query={from:'2026-09-30T23:00:00Z',to:'2026-10-01T01:00:00Z'};
    const beforeNew=await getPointHistory(c,f.actor,f.point.id,query,f.at);assert.equal(beforeNew.current,null);
    await ingest(c,{...f.reading,rawRef,sourceRecordId:'after-move',mappingVersion:moved.id,sampledAt:'2026-10-01T00:00:02Z',value:2,rawValue:2},f.at);
    const old=await getPointHistory(c,oldViewer,f.point.id,query,f.at);assert.equal(old.items.length,1);assert.equal(old.current,null);assert.equal(old.dataState,'history_only');
    const authorized=await getPointHistory(c,f.actor,f.point.id,query,f.at);assert.equal(authorized.current.value,2);
  },pool);
}));
test('适配器按采样时点自动解析台账，混合历史批次跨换塘仍归属各自对象',async()=>withDb(async pool=>{
  const f=await telemetryFixture(pool),nextObject=await objectFixture(pool,f.actor.id);await permit(pool,f.actor.id,nextObject,['read','configure']);
  await transaction(c=>bindPoint(c,f.actor,{pointId:f.point.id,objectId:nextObject,validFrom:'2026-10-01T00:00:01Z',verified:true,endPrevious:true,evidence:'合成换塘'}),pool);
  const results=await persistBatch(pool,{sourceId:f.source.id,raw:Buffer.from('{}'),receivedAt:f.at.toISOString(),synthetic:true,expectedCursor:null,nextCursor:'mixed-history',resolveMappings:true,readings:[{...f.reading,mappingVersion:'',origin:'history'},{...f.reading,mappingVersion:'',sourceRecordId:'r2',sampledAt:'2026-10-01T00:00:02Z',origin:'history'}]},f.at);
  assert.equal(results[0].eligibleForCurrent,false);assert.equal(results[1].eligibleForCurrent,true);
  assert.deepEqual((await pool.query('SELECT object_id FROM observations ORDER BY sampled_at')).rows.map(r=>r.object_id),[f.objectId,nextObject]);
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
  const f=await telemetryFixture(pool);const batch={sourceId:f.source.id,raw:Buffer.from('{}'),receivedAt:f.at.toISOString(),synthetic:true,expectedCursor:null,nextCursor:'c1',readings:[f.reading],contract:{version:'synthetic-v1',reference:'合成字段契约',snapshot:{scale:1,unit:'test_unit'}}};
  await assert.rejects(()=>persistBatch(pool,{...batch,readings:[f.reading,{...f.reading,sourceId:randomUUID()}]},f.at),{code:'SOURCE_MISMATCH'});
  for(const table of ['raw_receipts','observations','ingestion_cursors','domain_events','jobs'])assert.equal(Number((await pool.query('SELECT count(*) FROM '+table)).rows[0].count),0);
  assert.equal((await persistBatch(pool,batch,f.at))[0].disposition,'inserted');
  const archived=(await pool.query('SELECT contract_version,contract_sha256,contract_snapshot FROM raw_receipts')).rows[0];assert.equal(archived.contract_version,'synthetic-v1');assert.equal(archived.contract_snapshot.scale,1);assert.equal(archived.contract_sha256.length,64);
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
