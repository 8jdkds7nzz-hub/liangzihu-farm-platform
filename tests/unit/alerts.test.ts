import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate,type RuleVersion,type RuleRuntime } from '../../src/modules/alerts/evaluate';
import type { ReadingInput } from '../../src/modules/telemetry/types';
const rule:RuleVersion={id:'v1',version:1,metric:'synthetic',unit:'test',comparison:'lt',threshold:5,durationMs:30_000,maxGapMs:20_000,maxAgeMs:60_000,severity:'severe',approvedBy:'test-reviewer',effectiveFrom:'2026-01-01T00:00:00Z',effectiveTo:null};
const input=(seconds:number,value=1):ReadingInput=>({sourceId:'s',sourceRecordId:String(seconds),externalDeviceId:'d',pointId:'p',metric:'synthetic',sampledAt:new Date(Date.UTC(2026,9,1,0,0,seconds)).toISOString(),reportedAt:null,receivedAt:'2026-10-01T00:01:00Z',sequence:null,rawValue:value,value,unit:'test',quality:'valid',reasons:[],origin:'live',rawRef:'r',mappingVersion:'b'});
test('仅新样本连续越限计时，缺口/无效值/版本变化打断，重复旧值不能延长',()=>{
  let previous:RuleRuntime|null=null;
  for(const [second,expected] of [[0,'candidate'],[15,'candidate'],[30,'open']] as const){const x=input(second),result=evaluate(rule,previous,x,new Date(x.sampledAt!));assert.equal(result.kind,expected);previous={versionId:rule.id,lastSampledAt:x.sampledAt,candidateStartedAt:result.candidateStartedAt,previousMatched:result.matched,activeAlertId:null,activeState:null};}
  assert.equal(evaluate(rule,previous,input(30),new Date('2026-10-01T00:00:59Z')).kind,'ignore');
  const gap=evaluate(rule,previous,input(60),new Date('2026-10-01T00:01:00Z'));assert.equal(gap.kind,'candidate');assert.equal(gap.candidateStartedAt,input(60).sampledAt);
  assert.equal(evaluate(rule,previous,{...input(40),quality:'invalid'},new Date(input(40).sampledAt!)).kind,'monitoring_gap');
  assert.equal(evaluate({...rule,id:'v2'},previous,input(40),new Date(input(40).sampledAt!)).kind,'candidate');
});
test('未审核、旧数据、单位不符不会触发风险告警；恢复与关闭分开',()=>{
  const now=new Date(input(50).sampledAt!);
  assert.equal(evaluate({...rule,approvedBy:null},null,input(50),now).kind,'ignore');
  assert.equal(evaluate(rule,null,input(0),new Date('2026-10-01T01:00:00Z')).kind,'ignore');
  assert.equal(evaluate(rule,null,{...input(50),unit:'other'},now).kind,'monitoring_gap');
  const runtime:RuleRuntime={versionId:'v1',lastSampledAt:input(30).sampledAt,candidateStartedAt:input(0).sampledAt,previousMatched:true,activeAlertId:'a',activeState:'open'};
  assert.equal(evaluate(rule,runtime,input(50,10),now).kind,'recovered');
});
