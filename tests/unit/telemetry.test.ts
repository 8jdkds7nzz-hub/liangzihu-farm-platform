import test from 'node:test';
import assert from 'node:assert/strict';
import { readingIdentity } from '../../src/modules/telemetry/identity';
import { canUseAsCurrent } from '../../src/modules/telemetry/quality';
import type { ReadingInput } from '../../src/modules/telemetry/types';
const now=new Date('2026-10-01T00:00:10Z');
const base:ReadingInput={sourceId:'s',sourceRecordId:'r',externalDeviceId:'d',pointId:'p',metric:'test',sampledAt:'2026-10-01T00:00:00Z',reportedAt:null,receivedAt:now.toISOString(),sequence:null,rawValue:0,value:0,unit:'test',quality:'valid',reasons:[],origin:'live',rawRef:'raw',mappingVersion:'binding'};
test('测值身份排除到达时间，同刻不同指标与测点仍独立',()=>{
  assert.equal(readingIdentity(base),readingIdentity({...base,receivedAt:'2027-01-01T00:00:00Z'}));
  for(const changed of [{metric:'other'},{pointId:'other'},{sourceId:'other'},{externalDeviceId:'other'}])assert.notEqual(readingIdentity(base),readingIdentity({...base,...changed}));
  assert.equal(readingIdentity({...base,sourceRecordId:null,sampledAt:null}),null);
});
test('有效零可用于当前值；过期、未来、无时间、可疑质量和较早数据拒绝',()=>{
  assert.equal(canUseAsCurrent(base,null,now,10_000),true);
  for(const input of [{...base,sampledAt:'2026-09-30T23:00:00Z'},{...base,sampledAt:'2026-10-01T00:01:00Z'},{...base,sampledAt:null},{...base,quality:'invalid' as const},{...base,value:null}])assert.equal(canUseAsCurrent(input,null,now,10_000),false);
  assert.equal(canUseAsCurrent(base,base.sampledAt,now,10_000),false);
  assert.equal(canUseAsCurrent({...base,origin:'history'},null,now,10_000),true);
});
