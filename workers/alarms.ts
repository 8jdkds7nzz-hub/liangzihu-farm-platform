import pg from 'pg';
import { setTimeout as delay } from 'node:timers/promises';
import { readDatabaseConfig } from '../src/platform/config';
import { transaction } from '../src/db/pool';
import { runOne } from '../src/modules/jobs/runner';
import { evaluateObservation, scanMonitoringGaps } from '../src/modules/alerts/service';
import { heartbeat } from '../src/modules/operations/heartbeat';
const pool = new pg.Pool(readDatabaseConfig({ ...process.env, DB_POOL_MAX: process.env.ALARMS_DB_POOL_MAX ?? '2' }));
let stopped = false;
for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => { stopped = true; });
async function main() {
    let lastScan = 0;
    do {
        if (Date.now() - lastScan >= 5000) {
            await transaction(c => scanMonitoringGaps(c), pool);
            lastScan = Date.now();
        }
        const worked = await runOne(pool, 'alarms-' + process.pid, { 'telemetry.evaluate': job => transaction(async (c) => { await evaluateObservation(c, String(job.payload.eventId), String(job.payload.observationId)); }, pool) });
        const pendingFailure = (await pool.query("SELECT EXISTS(SELECT 1 FROM jobs WHERE kind='telemetry.evaluate' AND state IN ('retry_wait','failed')) AS found")).rows[0].found;
        await transaction(c => heartbeat(c, 'alarms', 'alarms-' + process.pid, pendingFailure ? 'failed' : 'ok', new Date(), !pendingFailure, pendingFailure ? 'ALARM_JOBS_UNRESOLVED' : null), pool);
        if (process.argv.includes('--once'))
            break;
        if (!worked)
            await delay(1000);
    } while (!stopped);
}
main().catch(() => { console.error('告警进程停止：数据库或处理依赖异常；未输出业务报文。'); process.exitCode = 1; }).finally(() => pool.end());
