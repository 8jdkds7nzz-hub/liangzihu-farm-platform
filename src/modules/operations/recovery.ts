export interface RecoveryEvidence {
    failureAt: string;
    latestRecoverableAt: string;
    coreReadyAt: string;
    checksumPassed: boolean;
    accessPassed: boolean;
    notificationPassed: boolean;
    scope: string[];
    checks: Record<string, boolean>;
    manifestRef: string;
    environment?: 'local_synthetic' | 'production';
}
export const CORE_RECOVERY_SCOPE = ['login', 'permissions', 'ingest', 'alarm_notice', 'night_phone', 'farm_record_read_write'] as const;
export function checkRecovery(e: RecoveryEvidence, requiredScope: readonly string[] = CORE_RECOVERY_SCOPE) {
    const reasons: string[] = [];
    const [failure, recoverable, ready] = [e.failureAt, e.latestRecoverableAt, e.coreReadyAt].map(Date.parse);
    if (![failure, recoverable, ready].every(Number.isFinite))
        reasons.push('时间证据无效');
    if (recoverable > failure || failure - recoverable > 900000)
        reasons.push('恢复点不满足15分钟');
    if (ready < failure || ready - failure > 7200000)
        reasons.push('恢复时间不满足2小时');
    if (!e.checksumPassed || !e.accessPassed || !e.notificationPassed)
        reasons.push('业务校验未通过');
    if (!e.manifestRef || !e.scope.length || !requiredScope.length)
        reasons.push('范围或清单缺失');
    if (requiredScope.some(k => !e.scope.includes(k) || e.checks[k] !== true))
        reasons.push('本次要求的功能未全部通过');
    const pass = reasons.length === 0, fullScope = CORE_RECOVERY_SCOPE.every(k => e.scope.includes(k) && e.checks[k] === true);
    return { pass, fullScope, productionReady: pass && fullScope && e.environment === 'production', reasons, rpoMs: failure - recoverable, rtoMs: ready - failure };
}
