import type { ReadingInput } from '../telemetry/types';
export interface RuleVersion {
    id: string;
    version: number;
    metric: string;
    unit: string;
    comparison: 'lt' | 'lte' | 'gt' | 'gte';
    threshold: number;
    durationMs: number;
    maxGapMs: number;
    maxAgeMs: number;
    severity: 'info' | 'warning' | 'severe';
    approvedBy: string | null;
    effectiveFrom: string;
    effectiveTo: string | null;
}
export interface RuleRuntime {
    versionId: string;
    lastSampledAt: string | null;
    candidateStartedAt: string | null;
    previousMatched: boolean;
    activeAlertId: string | null;
    activeState: 'open' | 'recovered' | null;
}
export interface Evaluation {
    kind: 'ignore' | 'candidate' | 'open' | 'continue' | 'recovered' | 'monitoring_gap';
    candidateStartedAt: string | null;
    matched: boolean;
    reason: string;
}
export function candidateStart(previousAt: number | null, previousStart: number | null, currentAt: number, maxGapMs: number, previousMatched: boolean): number {
    return previousAt !== null && currentAt > previousAt && currentAt - previousAt <= maxGapMs && previousMatched && previousStart !== null ? previousStart : currentAt;
}
export function evaluate(rule: RuleVersion, previous: RuleRuntime | null, x: ReadingInput, now: Date): Evaluation {
    const result = (kind: Evaluation['kind'], reason: string, candidateStartedAt: string | null = null, matched = false): Evaluation => ({ kind, reason, candidateStartedAt, matched });
    const at = now.getTime();
    if (!rule.approvedBy || at < Date.parse(rule.effectiveFrom) || (rule.effectiveTo && at >= Date.parse(rule.effectiveTo)))
        return result('ignore', 'rule_inactive');
    if (x.origin === 'manual' || x.metric !== rule.metric)
        return result('ignore', 'not_applicable');
    const sampled = x.sampledAt ? Date.parse(x.sampledAt) : NaN;
    if (!Number.isFinite(sampled) || sampled > at)
        return result('monitoring_gap', 'unknown_sample_time');
    if (at - sampled > rule.maxAgeMs)
        return result('ignore', 'old_sample');
    if (previous?.lastSampledAt && sampled <= Date.parse(previous.lastSampledAt))
        return result('ignore', 'already_processed');
    if (x.quality !== 'valid' || x.value === null || !Number.isFinite(x.value) || x.unit !== rule.unit)
        return result('monitoring_gap', 'invalid_sample');
    const matched = rule.comparison === 'lt' ? x.value < rule.threshold : rule.comparison === 'lte' ? x.value <= rule.threshold : rule.comparison === 'gt' ? x.value > rule.threshold : x.value >= rule.threshold;
    if (!matched)
        return result(previous?.activeState === 'open' ? 'recovered' : 'ignore', 'condition_cleared');
    const same = previous?.versionId === rule.id ? previous : null;
    const start = candidateStart(same?.lastSampledAt ? Date.parse(same.lastSampledAt) : null, same?.candidateStartedAt ? Date.parse(same.candidateStartedAt) : null, sampled, rule.maxGapMs, same?.previousMatched ?? false);
    return result(previous?.activeState === 'open' ? 'continue' : sampled - start >= rule.durationMs ? 'open' : 'candidate', 'condition_matched', new Date(start).toISOString(), true);
}
