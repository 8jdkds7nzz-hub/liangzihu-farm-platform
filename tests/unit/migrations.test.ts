import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMigrations } from '../../src/db/migrate';

test('迁移排序、版本与校验值稳定', async () => {
  const path = await mkdtemp(join(tmpdir(), 'agri-migrations-'));
  try {
    await writeFile(join(path, '002_second.sql'), 'SELECT 2;\n');
    await writeFile(join(path, '001_first.sql'), 'SELECT 1;\n');
    const first = await loadMigrations(path);
    const second = await loadMigrations(path);
    assert.deepEqual(first.map(x => x.version), [1, 2]);
    assert.equal(first[0].checksum.length, 64);
    assert.deepEqual(first, second);
  } finally { await rm(path, { recursive: true, force: true }); }
});

test('重复迁移版本在连接数据库前被拒绝', async () => {
  const path = await mkdtemp(join(tmpdir(), 'agri-migrations-'));
  try {
    await writeFile(join(path, '001_first.sql'), 'SELECT 1;');
    await writeFile(join(path, '001_duplicate.sql'), 'SELECT 2;');
    await assert.rejects(() => loadMigrations(path), { code: 'INVALID_MIGRATION' });
  } finally { await rm(path, { recursive: true, force: true }); }
});
