import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRenke } from '../../src/adapters/renke/adapter';
import type { RenkeContract } from '../../src/adapters/renke/contract';
const contract:RenkeContract={version:'synthetic-v1',reference:'合成字段，仅测试，无仁科接口依据',verified:true,synthetic:true,sourceId:'s',rowsPath:'合成列表',deviceIdPath:'合成设备',recordIdPath:'合成编号',sampledAtPath:'合成时间',reportedAtPath:null,timeFormat:'iso',statusPath:'合成状态',validStatuses:['合成正常'],offlineStatuses:['合成离线'],metrics:[{metric:'test',valuePath:'合成数值',sourceUnit:'test',unit:'test',scale:1,offset:0}],mappings:[{externalDeviceId:'D1',metric:'test',pointId:'p',bindingId:'b'}]};
test('契约控制字段与状态；有效零、离线零、缺少时间分开，合成契约不能当真实接入',()=>{
  const raw={'合成列表':[{'合成设备':'D1','合成编号':'r','合成时间':'2026-10-01T00:00:00Z','合成数值':0,'合成状态':'合成正常'}]};
  const at='2026-10-01T00:00:10Z';
  assert.throws(()=>normalizeRenke(raw,contract,at),{code:'RENKE_CONTRACT_NOT_READY'});
  assert.equal(normalizeRenke(raw,contract,at,'synthetic')[0].value,0);
  raw.合成列表[0].合成状态='合成离线';const offline=normalizeRenke(raw,contract,at,'synthetic')[0];assert.equal(offline.rawValue,0);assert.equal(offline.value,null);assert.equal(offline.quality,'invalid');
  raw.合成列表[0].合成时间='未提供';assert.equal(normalizeRenke(raw,contract,at,'synthetic')[0].sampledAt,null);
  assert.throws(()=>normalizeRenke(raw,{...contract,offlineStatuses:[...contract.validStatuses]},at,'synthetic'),{code:'AMBIGUOUS_STATUS_MAPPING'});
  assert.throws(()=>normalizeRenke(raw,{...contract,mappings:[...contract.mappings,...contract.mappings]},at,'synthetic'),{code:'UNMAPPED_DEVICE'});
});
