import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRecovery,CORE_RECOVERY_SCOPE,type RecoveryEvidence } from '../../src/modules/operations/recovery';
import { budgetAllows } from '../../src/modules/operations/budget';
const base:RecoveryEvidence={failureAt:'2026-10-01T00:00:00Z',latestRecoverableAt:'2026-09-30T23:45:00Z',coreReadyAt:'2026-10-01T02:00:00Z',checksumPassed:true,accessPassed:true,notificationPassed:true,scope:[...CORE_RECOVERY_SCOPE],checks:Object.fromEntries(CORE_RECOVERY_SCOPE.map(k=>[k,true])),manifestRef:'synthetic-manifest',environment:'local_synthetic'};
test('恢复点与恢复时间边界；文件存在、库启动均不能代替业务与范围验证',()=>{
  assert.equal(checkRecovery(base).pass,true);assert.equal(checkRecovery(base).productionReady,false);
  for(const bad of [{...base,latestRecoverableAt:'2026-09-30T23:44:59Z'},{...base,coreReadyAt:'2026-10-01T02:00:01Z'},{...base,checksumPassed:false},{...base,notificationPassed:false},{...base,checks:{...base.checks,night_phone:false}},{...base,scope:['login','permissions']},{...base,failureAt:'unknown'}])assert.equal(checkRecovery(bad).pass,false);
  const partial=checkRecovery({...base,scope:['login','permissions'],checks:{login:true,permissions:true}},['login','permissions']);assert.equal(partial.pass,true);assert.equal(partial.fullScope,false);
});
test('预算到达上限时非关键调用可停，但严重电话不能被预算禁止',()=>{assert.equal(budgetAllows(80,100,'voice',false),true);assert.equal(budgetAllows(100,100,'voice',false),false);assert.equal(budgetAllows(200,100,'voice',true),true);});
