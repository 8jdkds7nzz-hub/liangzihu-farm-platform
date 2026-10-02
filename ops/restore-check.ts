import assert from 'node:assert/strict';
import {seedRecovery,loseMedia,checkFieldRecovery} from './recovery-fixture';
import {seedPhase1Recovery,checkPhase1Recovery} from './phase1-recovery-fixture';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { withDb, requireTestDatabaseUrl } from '../tests/support/db';
import { telemetryFixture } from '../tests/support/telemetry';
import { canonicalJson } from '../src/platform/json';
import { hashPassword } from '../src/modules/identity/password';
import { login, enrollment, finishMfa, resolveSession } from '../src/modules/identity/session';
import { generate } from 'otplib';
import { transaction } from '../src/db/pool';
import { assertAccess } from '../src/modules/identity/access';
import { archiveReceipt, ingest } from '../src/modules/telemetry/ingest';
import { recordMaintenance } from '../src/modules/maintenance/records';
import { checkRecovery, type RecoveryEvidence } from '../src/modules/operations/recovery';
import { loadMigrations, runMigrations } from '../src/db/migrate';
import type { Pool } from 'pg';
import { parseEnv } from 'node:util';
const sha = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
async function snapshot(pool: Pool, schema: string) {
    const tables = (await pool.query('SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename', [schema])).rows;
    const result: Record<string, {
        rows: number;
        sha256: string;
    }> = {};
    for (const { tablename } of tables) {
        const rows = (await pool.query(`SELECT to_jsonb(t) AS data FROM ${quote(schema)}.${quote(tablename)} t ORDER BY to_jsonb(t)::text`)).rows.map(r => r.data);
        result[tablename] = { rows: rows.length, sha256: sha(canonicalJson(rows)) };
    }
    return result;
}
function postgres(command: 'pg_dump' | 'pg_restore', args: string[], input?: Buffer): Buffer {
    const url = new URL(requireTestDatabaseUrl());
    assert.equal(url.pathname, '/agri_test');
    assert.equal(url.username, 'agri_tester');
    try {
        return execFileSync('docker', ['exec', '-i', '-e', 'PGPASSWORD', 'liangzihu-farm-db', command, '--host', '127.0.0.1', '--username', 'agri_tester', '--dbname', 'agri_test', ...args], { input, env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) }, maxBuffer: 16 * 1024 * 1024, timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'] });
    }
    catch {
        throw new Error('隔离测试库备份或恢复命令失败；未输出凭据');
    }
}
async function main() {
    const run = new Date().toISOString().replace(/[-:.]/g, '').replace('T', '_').replace('Z', '') + '_' + randomUUID().slice(0, 8), directory = resolve('.local/恢复演练', run);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const report = await withDb(async (pool) => {
        const f = await telemetryFixture(pool), schema = (await pool.query('SELECT current_schema() AS name')).rows[0].name;
        assert.match(schema, /^test_[a-f0-9]{32}$/);
        const password = randomBytes(24).toString('hex'), encryptionKey = randomBytes(32).toString('hex'), options = { pool, encryptionKey };
        await pool.query('UPDATE users SET password_hash=$2 WHERE id=$1', [f.actor.id, await hashPassword(password)]);
        const challenge = await login(f.actor.id, password, options), factor = await enrollment(challenge.token, options);
        const authenticated = await finishMfa(challenge.token, await generate({ secret: factor.secret }), options);
        const field=await seedRecovery(pool,f.actor,f.objectId,directory);
        const phase1=await seedPhase1Recovery(pool,f,field,encryptionKey);
        const checkpoint = (await pool.query("INSERT INTO platform_metadata(key,value) VALUES('restore_probe',jsonb_build_object('checkpoint',clock_timestamp())) RETURNING value")).rows[0].value.checkpoint;
        const before = await snapshot(pool, schema), startedAt = new Date().toISOString();
        const dump = postgres('pg_dump', ['--schema', schema, '--format', 'custom', '--no-owner', '--no-acl']);
        assert.equal(dump.subarray(0, 5).toString(), 'PGDMP');
        const dumpPath = resolve(directory, '隔离测试库.dump'), keyPath = resolve(directory, '模拟身份密钥.env');
        await writeFile(dumpPath, dump, { mode: 0o600 });
        await writeFile(keyPath, 'IDENTITY_ENCRYPTION_KEY=' + encryptionKey + '\n', { mode: 0o600 });
        const manifest = { environment: 'local_synthetic', database: 'agri_test', schema, startedAt, completedAt: new Date().toISOString(), latestRecoverableAt: checkpoint, files: [{ name: '隔离测试库.dump', sha256: sha(dump), bytes: dump.length }, { name: '模拟身份密钥.env', sha256: sha(await readFile(keyPath)), bytes: (await readFile(keyPath)).length }], tables: before };
        const manifestPath = resolve(directory, '备份清单.json');
        await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
        assert.equal(sha(await readFile(dumpPath)), manifest.files[0].sha256);
        const failureAt = new Date().toISOString();
        // Only the random schema created by this run is removed; agri_dev and public are never targets.
        await loseMedia(directory);
        await pool.query('DROP SCHEMA ' + quote(schema) + ' CASCADE');
        assert.equal((await pool.query('SELECT to_regnamespace($1) AS present', [schema])).rows[0].present, null);
        postgres('pg_restore', ['--no-owner', '--no-acl', '--exit-on-error'], await readFile(dumpPath));
        const after = await snapshot(pool, schema);
        assert.deepEqual(after, before);
        assert.deepEqual(await runMigrations(pool, await loadMigrations()), []);
        const restoredKeyFile = await readFile(keyPath);
        assert.equal(sha(restoredKeyFile), manifest.files[1].sha256);
        const restoredKey = parseEnv(restoredKeyFile.toString()).IDENTITY_ENCRYPTION_KEY;
        assert(restoredKey, '独立密钥备份缺少模拟身份密钥');
        assert.match(restoredKey, /^[a-f0-9]{64}$/);
        const restoredOptions = { pool, encryptionKey: restoredKey };
        const fresh = await login(f.actor.id, password, restoredOptions), session = await finishMfa(fresh.token, authenticated.recoveryCodes![0], restoredOptions);
        const actor = await resolveSession(session.token, restoredOptions);
        await transaction(async (c) => { await assertAccess(c, actor, { objectId: f.objectId, action: 'read', at: new Date().toISOString() }); await assert.rejects(() => assertAccess(c, actor, { objectId: randomUUID(), action: 'read', at: new Date().toISOString() }), { status: 403 }); }, pool);
        await transaction(async (c) => { const at = new Date().toISOString(), rawRef = await archiveReceipt(c, f.source.id, Buffer.from('{"synthetic_restore_probe":true}'), at, true); const result = await ingest(c, { ...f.reading, rawRef, sourceRecordId: 'restore-after', sampledAt: at, receivedAt: at }); assert.equal(result.disposition, 'inserted'); await recordMaintenance(c, actor, { objectId: f.objectId, pointId: f.point.id, occurredAt: at, recordType: 'cleaning', description: '隔离恢复后的合成读写验证', source: '仅恢复演练', requestKey: randomUUID() }); }, pool);
        const fieldChecks=await checkFieldRecovery(pool,actor,f.objectId,field);
        const phase1Checks=await checkPhase1Recovery(pool,f,field,phase1);
        const coreReadyAt = new Date().toISOString();
        const evidence: RecoveryEvidence = { failureAt, latestRecoverableAt: checkpoint, coreReadyAt, checksumPassed: true, accessPassed: true, notificationPassed: false,
            scope: ['login', 'permissions', 'ingest', 'maintenance_read_write','farm_record_read_write','media','tasks','knowledge'], checks: { login: true, permissions: true, ingest: true, maintenance_read_write: true, alarm_notice: false, night_phone: false, farm_record_read_write: true }, manifestRef: manifestPath, environment: 'local_synthetic' };
        const result = checkRecovery(evidence);
        const report = { restoreVerified: true, environment: 'local_synthetic', database: 'agri_test', schema, tablesVerified: Object.keys(before).length, fieldChecks,phase1Checks, mediaManifest:[{assetId:field.assetId,checksum:field.checksum,bytes:field.bytes},{assetId:phase1.largeAssetId,checksum:phase1.largeChecksum,bytes:phase1.largeLength}],evidence, result, limits: ['只恢复自身随机测试schema', '未使用NAS或连续WAL生产备份链', '真实通知与夜间电话未联调', '本机合成样本与第二目录副本不等于生产异地恢复或真实规模RPO/RTO'] };
        await writeFile(resolve(directory, '恢复实测记录.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
        return { restoreVerified: true, tablesVerified: report.tablesVerified, rpoMs: result.rpoMs, rtoMs: result.rtoMs, productionReady: result.productionReady, reportPath: resolve(directory, '恢复实测记录.json') };
    });
    console.log(JSON.stringify(report, null, 2));
}
main().catch(async e => { await writeFile(resolve('.local/恢复失败诊断.json'),JSON.stringify({name:e?.name,code:e?.code,message:e?.message,stack:e?.stack},null,2),{mode:0o600}); console.error('隔离恢复演练未通过；仅清理本次测试schema，私有备份与清单保留供排查。'); process.exitCode = 1; });
