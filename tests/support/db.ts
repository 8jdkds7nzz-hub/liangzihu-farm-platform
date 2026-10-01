import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg, { type Pool } from 'pg';
import { loadMigrations, runMigrations } from '../../src/db/migrate';

export function requireTestDatabaseUrl(value = process.env.TEST_DATABASE_URL): string {
  assert(value, '缺少TEST_DATABASE_URL；测试不会自动使用DATABASE_URL');
  assert.equal(new URL(value).pathname, '/agri_test', '只允许agri_test测试库');
  return value;
}

export async function withDb<T>(fn: (pool: Pool) => Promise<T>, options: { migrate?: boolean } = {}): Promise<T> {
  const url = requireTestDatabaseUrl();
  const admin = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 2000 });
  const schema = 'test_' + randomUUID().replaceAll('-', '');
  let created = false;
  let pool: Pool | undefined;
  try {
    assert.equal((await admin.query('SELECT current_database() AS name')).rows[0].name, 'agri_test');
    await admin.query('CREATE SCHEMA ' + schema);
    created = true;
    pool = new pg.Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 2000, options: '-c search_path=' + schema + ',public' });
    assert.equal((await pool.query('SELECT current_schema() AS name')).rows[0].name, schema, '测试schema未生效');
    if (options.migrate !== false) await runMigrations(pool, await loadMigrations());
    return await fn(pool);
  } finally {
    await pool?.end();
    try { if (created) await admin.query('DROP SCHEMA ' + schema + ' CASCADE'); }
    finally { await admin.end(); }
  }
}
