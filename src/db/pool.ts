import pg, { type PoolClient, type Pool } from 'pg';
import { readDatabaseConfig } from '../platform/config';
import { AppError } from '../platform/error';

const runtime = globalThis as typeof globalThis & { agriPool?: Pool };
const unavailableCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', '57P01', '57P02', '57P03', '08000', '08003', '08006']);

function databaseError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  const value = error as { code?: string; message?: string };
  if (value?.code === '57014') return new AppError(503, 'QUERY_TIMEOUT', '查询超时，请缩小范围或稍后重试');
  if (unavailableCodes.has(value?.code ?? '') || /connection timeout|timeout exceeded|Connection terminated/i.test(value?.message ?? '')) {
    return new AppError(503, 'DATABASE_UNAVAILABLE', '数据库暂时不可用，请稍后重试');
  }
  return error;
}

export function getPool(): Pool {
  if (!runtime.agriPool) {
    const pool = new pg.Pool(readDatabaseConfig());
    pool.on('error', () => { process.stderr.write('数据库空闲连接中断，后续请求将重新连接。\n'); });
    runtime.agriPool = pool;
  }
  return runtime.agriPool;
}

export async function closePool(): Promise<void> {
  const pool = runtime.agriPool;
  runtime.agriPool = undefined;
  await pool?.end();
}

export async function database<T>(fn: (client: PoolClient) => Promise<T>, pool: Pool = getPool()): Promise<T> {
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    return await fn(client);
  } catch (error) { throw databaseError(error); }
  finally { client?.release(); }
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>, pool: Pool = getPool()): Promise<T> {
  return database(async client => {
    await client.query('BEGIN');
    try {
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  }, pool);
}
