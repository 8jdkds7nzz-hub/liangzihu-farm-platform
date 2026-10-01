import type { PoolConfig } from 'pg';
import { AppError } from './error';

type Environment = Record<string, string | undefined>;

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const result = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(result) || result < 1) {
    throw new AppError(503, 'INVALID_DATABASE_CONFIG', '数据库连接配置无效');
  }
  return result;
}

export function readDatabaseConfig(env: Environment = process.env): PoolConfig {
  if (!env.DATABASE_URL) {
    throw new AppError(503, 'DATABASE_NOT_CONFIGURED', '尚未配置当前平台数据库');
  }
  let url: URL;
  try { url = new URL(env.DATABASE_URL); }
  catch { throw new AppError(503, 'INVALID_DATABASE_CONFIG', '数据库连接配置无效'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) {
    throw new AppError(503, 'INVALID_DATABASE_CONFIG', '数据库连接配置无效');
  }
  return {
    connectionString: env.DATABASE_URL,
    max: positiveInteger(env.DB_POOL_MAX, 5),
    connectionTimeoutMillis: positiveInteger(env.DB_CONNECTION_TIMEOUT_MS, 3000),
    idleTimeoutMillis: 10000,
    application_name: 'liangzihu-farm-platform',
  };
}
