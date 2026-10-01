import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withDb } from '../support/db';
import { actorFixture,objectFixture,permit } from '../support/fixtures';
import { transaction } from '../../src/db/pool';
import { saveObject,listObjects } from '../../src/modules/registry/objects';
import { saveSource,saveDevice,listDevices,verifyDevice } from '../../src/modules/registry/devices';
import { savePoint,bindPoint,resolvePointBinding } from '../../src/modules/registry/points';
import { saveBatch } from '../../src/modules/registry/batches';
import { importDevices } from '../../src/modules/registry/import';

test('对象创建要求父级配置权；版本保留，列表总数仅含授权对象',async()=>withDb(async pool=>{
  const admin=await actorFixture(pool), outsider=await actorFixture(pool,'worker');
  const root=await objectFixture(pool,admin.id);await permit(pool,admin.id,root,['read','configure']);
  const pond=await transaction(c=>saveObject(c,admin,{parentId:root,code:'SYNTH-POND',name:'合成测试塘',kind:'pond',source:'测试样例'}),pool);
  await assert.rejects(()=>transaction(c=>saveObject(c,outsider,{parentId:root,code:'NO',name:'无权',kind:'pond',source:'测试'}),pool),{status:403});
  await transaction(c=>saveObject(c,admin,{id:pond.id,version:1,name:'测试更名',kind:'pond',source:'测试',reason:'修正名称'}),pool);
  await assert.rejects(()=>transaction(c=>saveObject(c,admin,{id:pond.id,version:1,name:'旧覆盖',kind:'pond',source:'测试'}),pool),{status:409});
  assert.equal(Number((await pool.query('SELECT count(*) FROM object_versions WHERE object_id=$1',[pond.id])).rows[0].count),2);
  assert.equal((await transaction(c=>listObjects(c,outsider),pool)).total,0);
  assert.equal((await transaction(c=>listObjects(c,admin,1,0),pool)).total,2);
}));

test('设备分类分开计数、编号不重复、测点换塘保留历史绑定且未核实状态可辨',async()=>withDb(async pool=>{
  const admin=await actorFixture(pool),a=await objectFixture(pool,admin.id),b=await objectFixture(pool,admin.id);
  await permit(pool,admin.id,a,['read','configure']);await permit(pool,admin.id,b,['read','configure']);
  await transaction(async c=>{
    const source=await saveSource(c,admin,{objectId:a,code:'SYNTH',name:'合成来源',provider:'test'});
    const device=await saveDevice(c,admin,{objectId:a,sourceId:source.id,externalId:'S-1',name:'合成设备',kind:'physical',source:'测试'});
    await saveDevice(c,admin,{objectId:a,sourceId:source.id,externalId:'CH-1',name:'合成通道',kind:'camera_channel',parentDeviceId:device.id,source:'测试'});
    const point=await savePoint(c,admin,{deviceId:device.id,code:'S-P1',name:'合成测点',metric:'synthetic_metric',unit:'test_unit'});
    const first=await bindPoint(c,admin,{pointId:point.id,objectId:a,validFrom:'2026-01-01T00:00:00Z',evidence:'测试迁移前',verified:true});
    const second=await bindPoint(c,admin,{pointId:point.id,objectId:b,validFrom:'2026-02-01T00:00:00Z',endPrevious:true,evidence:'测试迁移后',verified:false});
    assert.deepEqual(await resolvePointBinding(c,point.id,'2026-01-31T23:59:59Z'),{objectId:a,bindingId:first.id,verified:true});
    assert.deepEqual(await resolvePointBinding(c,point.id,'2026-02-01T00:00:00Z'),{objectId:b,bindingId:second.id,verified:false});
    await assert.rejects(()=>bindPoint(c,admin,{pointId:point.id,objectId:a,validFrom:'2026-03-01T00:00:00Z',evidence:'重复',verified:true}),{status:409});
    const counts=(await listDevices(c,admin)).counts;
    assert.deepEqual(Object.fromEntries(counts.map(r=>[r.kind,r.count])),{physical:1,camera_channel:1});
    assert.equal((await verifyDevice(c,admin,device.id,'合成现场核实说明')).verified,true);
    await c.query('INSERT INTO point_bindings(point_id,object_id,valid_from,evidence,created_by) VALUES($1,$2,$3,$4,$5)',[point.id,a,'2026-02-01T00:00:00Z','人工污染冲突测试',admin.id]);
    await assert.rejects(()=>resolvePointBinding(c,point.id,'2026-02-02T00:00:00Z'),{code:'BINDING_CONFLICT'});
  },pool);
}));

test('生产批次包含来源、物种、阶段；更正追加且不能引用其他对象',async()=>withDb(async pool=>{
  const admin=await actorFixture(pool),objectId=await objectFixture(pool,admin.id);await permit(pool,admin.id,objectId,['configure']);
  await transaction(async c=>{
    const base={objectId,code:'TEST-B1',species:'合成物种',stage:'测试阶段',source:'仅测试',startedAt:'2026-01-01T00:00:00Z'};
    const first=await saveBatch(c,admin,base);
    await saveBatch(c,admin,{...base,code:'TEST-B2',stage:'更正阶段',supersedesId:first.id});
    assert.equal(Number((await c.query('SELECT count(*) FROM production_batches')).rows[0].count),2);
    assert.equal((await c.query('SELECT stage FROM production_batches WHERE id=$1',[first.id])).rows[0].stage,'测试阶段');
    await assert.rejects(()=>saveBatch(c,admin,{...base,code:'TEST-B3',supersedesId:randomUUID()}),{status:422});
  },pool);
}));

test('批量台账逐行返回错误，成功行不因其他行失败而丢失',async()=>withDb(async pool=>{
  const actor=await actorFixture(pool),objectId=await objectFixture(pool,actor.id);await permit(pool,actor.id,objectId,['configure']);
  const result=await transaction(async c=>{
    const source=await saveSource(c,actor,{objectId,code:'IMPORT-SYNTH',name:'合成来源',provider:'test'});
    const row={objectId,sourceId:source.id,externalId:'S-1',name:'合成设备',kind:'physical',source:'仅测试'};
    return importDevices(c,actor,[row,{...row,externalId:'S-2',kind:'invalid'},row]);
  },pool);
  assert.deepEqual(result.rows.map(r=>r.ok),[true,false,false]);
  assert.equal(Number((await pool.query('SELECT count(*) FROM devices')).rows[0].count),1);
}));
