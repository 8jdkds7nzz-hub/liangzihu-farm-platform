import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError, toApiError } from '../../src/platform/error';
import { readDatabaseConfig } from '../../src/platform/config';

test('明确的业务错误保留状态和请求标识', () => {
  const result = toApiError(new AppError(403, 'FORBIDDEN', '没有访问权限'), 'request-1');
  assert.deepEqual(result, {
    status: 403,
    body: { code: 'FORBIDDEN', message: '没有访问权限', requestId: 'request-1' },
  });
});

test('未知错误不把内部诊断返回给客户端', () => {
  const result = toApiError(new Error('internal-database-diagnostic'), 'request-2');
  assert.equal(result.status, 500);
  assert.equal(result.body.requestId, 'request-2');
  assert.equal(JSON.stringify(result).includes('internal-database-diagnostic'), false);
});

test('缺失或非法数据库配置明确失败且不输出连接内容', () => {
  assert.throws(() => readDatabaseConfig({}), { code: 'DATABASE_NOT_CONFIGURED' });
  assert.throws(() => readDatabaseConfig({ DATABASE_URL: 'https://internal-host/db' }), { code: 'INVALID_DATABASE_CONFIG' });
  assert.throws(() => readDatabaseConfig({ DATABASE_URL: 'postgresql://localhost/agri_dev', DB_POOL_MAX: '0' }), { code: 'INVALID_DATABASE_CONFIG' });
});

test('连接池预算与超时从当前项目配置读取', () => {
  const result = readDatabaseConfig({ DATABASE_URL: 'postgresql://localhost/agri_dev', DB_POOL_MAX: '3', DB_CONNECTION_TIMEOUT_MS: '1200' });
  assert.equal(result.max, 3);
  assert.equal(result.connectionTimeoutMillis, 1200);
});
