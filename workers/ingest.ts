import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { transaction } from '../src/db/pool';
import { readDatabaseConfig } from '../src/platform/config';
import { AppError } from '../src/platform/error';
import { normalizeRenke } from '../src/adapters/renke/adapter';
import type { RenkeContract } from '../src/adapters/renke/contract';
import { archiveReceipt, persistBatch } from '../src/modules/telemetry/ingest';
import { heartbeat } from '../src/modules/operations/heartbeat';
const pool = new pg.Pool(readDatabaseConfig({ ...process.env, DB_POOL_MAX: process.env.INGEST_DB_POOL_MAX ?? '2' }));
async function main() {
    const [mode, contractPath, payloadPath, cursor] = process.argv.slice(2);
    if (!['--replay', '--synthetic-replay'].includes(mode) || !contractPath || !payloadPath || !cursor)
        throw new AppError(400, 'USAGE', '用法：worker:ingest --replay 契约文件 原报文文件 下一游标；合成回放仅允许agri_test');
    const synthetic = mode === '--synthetic-replay';
    if (synthetic && (await pool.query('SELECT current_database() AS name')).rows[0].name !== 'agri_test')
        throw new AppError(403, 'SYNTHETIC_TEST_ONLY', '合成报文只能写入agri_test');
    const contract: RenkeContract = JSON.parse(await readFile(contractPath, 'utf8')), raw = await readFile(payloadPath), receivedAt = new Date().toISOString();
    if (contract.synthetic !== synthetic)
        throw new AppError(422, 'MODE_MISMATCH', '契约性质与回放模式不一致');
    let readings;
    try {
        readings = normalizeRenke(JSON.parse(raw.toString('utf8')), contract, receivedAt, synthetic ? 'synthetic' : 'real').map(x => ({ ...x, origin: 'history' as const }));
    }
    catch (e) {
        if (e instanceof AppError && e.code === 'RENKE_CONTRACT_NOT_READY')
            throw e;
        await transaction(async (c) => { const rawRef = await archiveReceipt(c, contract.sourceId, raw, receivedAt, synthetic); await c.query('INSERT INTO quarantined_readings(raw_ref,input,reasons) VALUES($1,$2,$3)', [rawRef, { contractVersion: contract.version }, ['adapter_rejected']]); }, pool);
        throw new AppError(422, 'REPLAY_QUARANTINED', '原报文已留存待核；未推进游标');
    }
    const expectedCursor = (await pool.query('SELECT cursor FROM ingestion_cursors WHERE source_id=$1', [contract.sourceId])).rows[0]?.cursor ?? null;
    const snapshot = { version: contract.version, reference: contract.reference, verified: contract.verified, synthetic: contract.synthetic, sourceId: contract.sourceId,
        rowsPath: contract.rowsPath, deviceIdPath: contract.deviceIdPath, recordIdPath: contract.recordIdPath, sampledAtPath: contract.sampledAtPath, reportedAtPath: contract.reportedAtPath,
        timeFormat: contract.timeFormat, statusPath: contract.statusPath, validStatuses: contract.validStatuses, offlineStatuses: contract.offlineStatuses,
        metrics: contract.metrics.map(m => ({ metric: m.metric, valuePath: m.valuePath, sourceUnit: m.sourceUnit, unit: m.unit, scale: m.scale, offset: m.offset })),
        mappings: contract.mappings.map(m => ({ externalDeviceId: m.externalDeviceId, metric: m.metric, pointId: m.pointId })) };
    const results = await persistBatch(pool, { sourceId: contract.sourceId, raw, receivedAt, synthetic, expectedCursor, nextCursor: cursor, readings, resolveMappings: true, contract: { version: contract.version, reference: contract.reference, snapshot } });
    await transaction(c => heartbeat(c, 'ingest', 'replay-' + process.pid, 'blocked', new Date(), true, 'REPLAY_ONLY_G02_PENDING'), pool);
    console.log(JSON.stringify({ mode, inserted: results.filter(r => r.disposition === 'inserted').length, duplicate: results.filter(r => r.disposition === 'duplicate').length, conflict: results.filter(r => r.disposition === 'conflict').length, quarantined: results.filter(r => r.disposition === 'quarantined').length }));
}
main().catch(e => { console.error(e instanceof AppError ? e.message : '采集回放失败；未输出原报文或连接信息'); process.exitCode = 1; }).finally(() => pool.end());
