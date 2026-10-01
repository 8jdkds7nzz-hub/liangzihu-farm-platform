import { createHash, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AppError } from '../../platform/error';
export const CORE_SERVICES = ['ingest', 'alarms', 'notifications'] as const;
export async function heartbeat(c: PoolClient, service: string, instanceId: string, state: 'ok' | 'blocked' | 'failed', at = new Date(), success = false, detailCode: string | null = null) {
    if (detailCode && !/^[A-Z0-9_]{1,100}$/.test(detailCode))
        throw new AppError(400, 'INVALID_HEARTBEAT', '健康状态说明须使用固定代号');
    await c.query(`INSERT INTO service_heartbeats(service,instance_id,state,observed_at,last_success_at,detail_code) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(service) DO UPDATE SET instance_id=$2,state=$3,observed_at=$4,last_success_at=COALESCE($5,service_heartbeats.last_success_at),detail_code=$6`, [service, instanceId, state, at, success ? at : null, detailCode]);
}
export function authorizeHealth(request: Request, token = process.env.HEALTHCHECK_TOKEN) {
    if (!token || !/^[a-f0-9]{64}$/.test(token))
        throw new AppError(503, 'HEALTH_NOT_CONFIGURED', '健康检查凭据尚未配置');
    const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
    const hash = (s: string) => createHash('sha256').update(s).digest();
    if (!timingSafeEqual(hash(supplied), hash(token)))
        throw new AppError(401, 'HEALTH_AUTH_REQUIRED', '健康检查未授权');
}
export async function readiness(c: PoolClient, at = new Date(), maxAgeMs = 60000) {
    const heartbeats = (await c.query('SELECT service,state,observed_at,last_success_at,detail_code FROM service_heartbeats')).rows;
    const services = CORE_SERVICES.map(service => {
        const row = heartbeats.find(h => h.service === service);
        const fresh = !!row && at.getTime() - row.observed_at.getTime() >= 0 && at.getTime() - row.observed_at.getTime() <= maxAgeMs;
        const processed = !!row?.last_success_at && at.getTime() - row.last_success_at.getTime() >= 0 && at.getTime() - row.last_success_at.getTime() <= maxAgeMs;
        return { service, ready: fresh && processed && row?.state === 'ok', state: row?.state ?? 'missing', observedAt: row?.observed_at ?? null, lastSuccessAt: row?.last_success_at ?? null, detailCode: row?.detail_code ?? null };
    });
    const databaseName = (await c.query('SELECT current_database() AS name')).rows[0].name;
    const backup = (await c.query("SELECT completed_at,latest_recoverable_at,checksum_passed,manifest_ref,scope,evidence FROM backup_runs WHERE state='verified' ORDER BY latest_recoverable_at DESC NULLS LAST LIMIT 1")).rows[0];
    const backupReady = !!backup?.checksum_passed && backup.scope.includes('database') && backup.evidence.database === databaseName && !!backup.latest_recoverable_at && at.getTime() - backup.latest_recoverable_at.getTime() >= 0 && at.getTime() - backup.latest_recoverable_at.getTime() <= 900000;
    const jobs = (await c.query("SELECT state,count(*)::integer AS count FROM jobs WHERE state IN ('queued','retry_wait','awaiting_receipt','failed') GROUP BY state")).rows;
    const criticalFailures = Number((await c.query("SELECT count(*) FROM jobs WHERE state='failed' AND kind IN ('telemetry.evaluate','notification.plan','notice.send')")).rows[0].count);
    return { ready: services.every(s => s.ready) && backupReady && criticalFailures === 0, database: 'reachable', services, backup: { ready: backupReady, latestRecoverableAt: backup?.latest_recoverable_at ?? null }, jobs, criticalFailures };
}
