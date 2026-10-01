import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { AppError } from '../platform/error';
import { closePool, getPool, transaction } from './pool';

export interface Migration { version: number; name: string; checksum: string; sql: string }
interface AppliedMigration { version: number; name: string; checksum: string }
const defaultDirectory = new URL('../../db/migrations/', import.meta.url);

export async function loadMigrations(directory: string | URL = defaultDirectory): Promise<Migration[]> {
  const names = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
  if (!names.length) throw new AppError(500, 'INVALID_MIGRATION', '没有可读取的迁移文件');
  const versions = new Set<number>();
  const migrations: Migration[] = [];
  for (const name of names) {
    const match = /^(\d{3})_[a-z0-9_]+\.sql$/.exec(name);
    if (!match) throw new AppError(500, 'INVALID_MIGRATION', '迁移文件命名无效：' + name);
    const version = Number(match[1]);
    if (versions.has(version)) throw new AppError(500, 'INVALID_MIGRATION', '迁移版本重复：' + version);
    versions.add(version);
    const path = typeof directory === 'string' ? resolve(directory, name) : new URL(name, directory);
    const sql = await readFile(path, 'utf8');
    migrations.push({ version, name, checksum: createHash('sha256').update(sql).digest('hex'), sql });
  }
  return migrations.sort((a, b) => a.version - b.version);
}

export async function runMigrations(pool: Pool, migrations: readonly Migration[]): Promise<string[]> {
  return transaction(async client => {
    // Only migrations serialize. Normal business transactions do not acquire this lock.
    await client.query('SELECT pg_advisory_xact_lock(hashtext(current_database()), hashtext(current_schema()))');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version integer PRIMARY KEY, name text NOT NULL UNIQUE, checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = (await client.query<AppliedMigration>('SELECT version,name,checksum FROM schema_migrations ORDER BY version')).rows;
    for (const row of applied) {
      const migration = migrations.find(item => item.version === row.version);
      if (!migration || migration.name !== row.name || migration.checksum !== row.checksum) {
        throw new AppError(409, 'MIGRATION_DRIFT', '已应用迁移与当前文件不一致：' + row.name);
      }
    }
    const appliedVersions = new Set(applied.map(row => row.version));
    const lastApplied = applied.at(-1)?.version ?? -1;
    const changed: string[] = [];
    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) continue;
      if (migration.version < lastApplied) throw new AppError(409, 'MIGRATION_ORDER', '不能在已应用版本之前追加迁移');
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations(version,name,checksum) VALUES($1,$2,$3)', [migration.version, migration.name, migration.checksum]);
      changed.push(migration.name);
    }
    return changed;
  }, pool);
}

async function main(): Promise<void> {
  try {
    const migrations = await loadMigrations();
    const pool = getPool();
    if (process.argv.includes('--status')) {
      const exists = (await pool.query('SELECT to_regclass($1) AS name', ['schema_migrations'])).rows[0].name;
      const applied = exists ? (await pool.query('SELECT version,name,checksum,applied_at FROM schema_migrations ORDER BY version')).rows : [];
      console.log(JSON.stringify({ available: migrations.map(x => x.name), applied }, null, 2));
    } else {
      console.log(JSON.stringify({ applied: await runMigrations(pool, migrations) }));
    }
  } catch (error) {
    process.stderr.write((error instanceof AppError ? error.message : '数据库迁移失败，请检查连接及迁移文件。') + '\n');
    process.exitCode = 1;
  } finally { await closePool(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
