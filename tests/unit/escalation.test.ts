import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneDue } from '../../src/modules/notifications/escalation';
test('3分钟边界、已认领和非夜班均明确控制电话升级',()=>{
  assert.equal(phoneDue(0,179_999,false,true,true),false);
  assert.equal(phoneDue(0,180_000,false,true,true),true);
  assert.equal(phoneDue(0,180_000,true,true,true),false);
  assert.equal(phoneDue(0,180_000,false,true,false),false);
  assert.equal(phoneDue(null,180_000,false,true,true),false);
});
