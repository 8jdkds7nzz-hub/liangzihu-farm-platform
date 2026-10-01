import type { ReadingInput } from './types';
export function readingIdentity(x: ReadingInput): string | null {
    if (!x.sourceRecordId && !x.sampledAt)
        return null;
    return JSON.stringify([x.sourceId, x.externalDeviceId, x.pointId, x.metric, x.sourceRecordId ? ['id', x.sourceRecordId] : ['time', x.sampledAt, x.sequence]]);
}
export function readingContent(x: ReadingInput): string {
    return JSON.stringify([x.sampledAt, x.reportedAt, x.sequence, x.rawValue, x.value, x.unit, x.quality, [...x.reasons].sort()]);
}
