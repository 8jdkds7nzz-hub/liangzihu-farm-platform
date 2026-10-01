import test from 'node:test';
import assert from 'node:assert/strict';
import { requireTestDatabaseUrl } from '../support/db';

test('测试辅助程序拒绝开发库和其他库', () => {
  assert.throws(() => requireTestDatabaseUrl('postgresql://localhost/agri_dev'), /只允许agri_test/);
  assert.throws(() => requireTestDatabaseUrl('postgresql://localhost/postgres'), /只允许agri_test/);
  assert.equal(requireTestDatabaseUrl('postgresql://localhost/agri_test'), 'postgresql://localhost/agri_test');
});
