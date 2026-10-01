import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { withDb, requireTestDatabaseUrl } from '../support/db';
import { loadMigrations, runMigrations, type Migration } from '../../src/db/migrate';
import { transaction } from '../../src/db/pool';

test('PostGIS在隔离测试库可用', async () => withDb(async pool => {
  const row = (await pool.query("SELECT postgis_lib_version() AS version, ST_AsText(ST_SetSRID(ST_MakePoint(114,30),4326)) AS point")).rows[0];
  assert.match(row.version, /^3\./);
  assert.equal(row.point, 'POINT(114 30)');
}));

test('迁移两次只应用一次', async () => withDb(async pool => {
  const migrations = await loadMigrations();
  assert.deepEqual(await runMigrations(pool, migrations), ['000_platform.sql']);
  assert.deepEqual(await runMigrations(pool, migrations), []);
  assert.equal(Number((await pool.query('SELECT count(*) FROM schema_migrations')).rows[0].count), 1);
}, { migrate: false }));

test('两个执行者并发迁移不重复应用', async () => withDb(async pool => {
  const migrations = await loadMigrations();
  const results = await Promise.all([runMigrations(pool, migrations), runMigrations(pool, migrations)]);
  assert.equal(results.flat().length, 1);
  assert.equal(Number((await pool.query('SELECT count(*) FROM platform_metadata')).rows[0].count), 1);
}, { migrate: false }));

test('失败事务完整回滚并释放连接', async () => withDb(async pool => {
  await pool.query('CREATE TABLE transaction_probe(id integer PRIMARY KEY)');
  await transaction(async client => { await client.query('INSERT INTO transaction_probe VALUES(1)'); }, pool);
  for (let i = 0; i < 6; i++) {
    await assert.rejects(() => transaction(async client => {
      await client.query('INSERT INTO transaction_probe VALUES(2)');
      throw new Error('rollback-probe');
    }, pool), /rollback-probe/);
  }
  assert.deepEqual((await pool.query('SELECT id FROM transaction_probe ORDER BY id')).rows, [{ id: 1 }]);
  assert.equal(pool.waitingCount, 0);
}));

test('有错误的迁移不遗留DDL或迁移标记', async () => withDb(async pool => {
  const base = await loadMigrations();
  const sql = 'CREATE TABLE failed_migration_probe(id integer); SELECT * FROM table_that_does_not_exist;';
  const broken: Migration = { version: 1, name: '001_failure.sql', sql, checksum: createHash('sha256').update(sql).digest('hex') };
  await assert.rejects(() => runMigrations(pool, [...base, broken]), { code: '42P01' });
  assert.equal((await pool.query("SELECT to_regclass('failed_migration_probe') AS name")).rows[0].name, null);
  assert.equal(Number((await pool.query('SELECT count(*) FROM schema_migrations')).rows[0].count), 1);
}));

test('已应用迁移修改后拒绝继续执行', async () => withDb(async pool => {
  const base = await loadMigrations();
  const changed = base.map(x => ({ ...x, checksum: '0'.repeat(64) }));
  await assert.rejects(() => runMigrations(pool, changed), { code: 'MIGRATION_DRIFT' });
  assert.equal(Number((await pool.query('SELECT count(*) FROM platform_metadata')).rows[0].count), 1);
}));

test('不同测试schema之间互不串数据', async () => {
  await withDb(async first => withDb(async second => {
    const firstSchema = (await first.query('SELECT current_schema() AS name')).rows[0].name;
    const secondSchema = (await second.query('SELECT current_schema() AS name')).rows[0].name;
    assert.notEqual(firstSchema, secondSchema);
    await first.query("INSERT INTO platform_metadata(key,value) VALUES('isolated','1')");
    assert.equal(Number((await second.query("SELECT count(*) FROM platform_metadata WHERE key='isolated'")).rows[0].count), 0);
  }));
});

test('测试角色不能连接开发库', async () => {
  const url = new URL(requireTestDatabaseUrl());
  url.pathname = '/agri_dev';
  const pool = new pg.Pool({ connectionString: url.toString(), connectionTimeoutMillis: 2000 });
  try { await assert.rejects(() => pool.query('SELECT 1'), { code: '42501' }); }
  finally { await pool.end(); }
});
