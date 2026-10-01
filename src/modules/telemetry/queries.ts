import type { PoolClient } from 'pg';
import type { Actor } from '../../platform/types';
import { AppError } from '../../platform/error';
import { integer, time } from '../../platform/validation';
import { listAccessibleObjects } from '../identity/access';
import { denied, uuid } from '../identity/common';
import { freshness } from './quality';
import { resolvePointBinding } from '../registry/points';
export async function getPointHistory(c: PoolClient, actor: Actor, pointId: string, query: {
    from: string;
    to: string;
    cursor?: string | null;
    limit?: number;
}, at = new Date()) {
    uuid(pointId);
    const from = time(query.from), to = time(query.to), limit = integer(query.limit ?? 200, '条数', 1, 500);
    if (from >= to || Date.parse(to) - Date.parse(from) > 31 * 86400000)
        throw new AppError(400, 'INVALID_PERIOD', '查询时段须大于零且不超过31天');
    const ids = await listAccessibleObjects(c, actor, 'read');
    const point = (await c.query(`SELECT p.*,d.source_id FROM points p JOIN devices d ON d.id=p.device_id WHERE p.id=$1
    AND (d.object_id=ANY($2::uuid[]) OR EXISTS(SELECT 1 FROM point_bindings b WHERE b.point_id=p.id AND b.object_id=ANY($2::uuid[])))`, [pointId, ids])).rows[0];
    if (!point)
        throw denied();
    let cursorTime: string | null = null, cursorId: string | null = null;
    if (query.cursor) {
        try {
            const decoded = JSON.parse(Buffer.from(query.cursor, 'base64url').toString());
            cursorTime = time(decoded.time);
            uuid(decoded.id);
            cursorId = decoded.id;
        }
        catch {
            throw new AppError(400, 'INVALID_CURSOR', '分页标识无效');
        }
    }
    const rows = (await c.query(`SELECT o.id,o.object_id,o.point_id,o.sampled_at,o.reported_at,o.received_at,o.raw_value,o.value::float8,o.unit,o.metric,o.quality AS original_quality,
    CASE WHEN h.conflicted THEN 'suspect' ELSE o.quality END AS quality,o.reasons,h.conflicted,o.binding_id,o.raw_ref,o.origin,
    (h.canonical_id=o.id) AS canonical
    FROM observations o JOIN observation_heads h ON h.id=o.head_id
    WHERE o.point_id=$1 AND o.object_id=ANY($2::uuid[]) AND o.sampled_at>=$3 AND o.sampled_at<$4
    AND ($5::timestamptz IS NULL OR (o.sampled_at,o.id)>($5::timestamptz,$6::uuid))
    ORDER BY o.sampled_at,o.id LIMIT $7`, [pointId, ids, from, to, cursorTime, cursorId, limit + 1])).rows;
    const more = rows.length > limit;
    const items = rows.slice(0, limit);
    let current = (await c.query(`SELECT o.id,o.object_id,o.binding_id,o.value::float8,o.unit,p.sampled_at,p.quality,p.reasons FROM point_current p
    JOIN observations o ON o.id=p.observation_id WHERE p.point_id=$1 AND o.object_id=ANY($2::uuid[])`, [pointId, ids])).rows[0] ?? null;
    let binding: Awaited<ReturnType<typeof resolvePointBinding>> = null;
    try {
        binding = await resolvePointBinding(c, pointId, at.toISOString());
    }
    catch (e) {
        if (!(e instanceof AppError && e.code === 'BINDING_CONFLICT'))
            throw e;
    }
    const currentReadable = !!binding?.verified && ids.includes(binding.objectId);
    if (!currentReadable || current?.binding_id !== binding?.bindingId)
        current = null;
    const latest = currentReadable ? (await c.query(`SELECT o.sampled_at,o.quality,h.conflicted FROM observations o JOIN observation_heads h ON h.id=o.head_id
    WHERE o.point_id=$1 AND o.object_id=ANY($2::uuid[]) AND o.binding_id=$5 AND o.origin<>'manual' AND ($3::timestamptz IS NULL OR o.sampled_at>=$3)
    AND NOT(o.origin='history' AND o.sampled_at>$4) ORDER BY o.received_at DESC,o.sampled_at DESC NULLS LAST LIMIT 1`, [pointId, ids, current?.sampled_at ?? null, at, binding!.bindingId])).rows[0] : null;
    const dataState = !binding?.verified ? 'unverified_mapping' : !currentReadable ? 'history_only' : latest && (latest.quality !== 'valid' || latest.conflicted || latest.sampled_at > at) ? 'suspect' : freshness(current?.sampled_at.toISOString() ?? null, current?.quality ?? null, at, point.max_age_ms);
    const health = (await c.query('SELECT state,last_attempt_at,last_success_at FROM source_health WHERE source_id=$1', [point.source_id])).rows[0] ?? null;
    const gaps: {
        from: string;
        to: string;
    }[] = [];
    if (point.max_gap_ms !== null) {
        let previous: string | null = null;
        for (const row of items) {
            const stamp = row.sampled_at?.toISOString();
            if (stamp && previous && Date.parse(stamp) - Date.parse(previous) > point.max_gap_ms)
                gaps.push({ from: previous, to: stamp });
            if (stamp)
                previous = stamp;
        }
    }
    const last = items.at(-1);
    const maintenance = (await c.query('SELECT id,occurred_at,record_type,payload,source,supersedes_id FROM maintenance_records WHERE point_id=$1 AND object_id=ANY($2::uuid[]) AND occurred_at>=$3 AND occurred_at<$4 ORDER BY occurred_at,id LIMIT 500', [pointId, ids, from, to])).rows;
    const manualChecks = (await c.query('SELECT id,occurred_at,raw_value,value::float8,unit,metric,method,source,supersedes_id FROM manual_checks WHERE point_id=$1 AND object_id=ANY($2::uuid[]) AND occurred_at>=$3 AND occurred_at<$4 ORDER BY occurred_at,id LIMIT 500', [pointId, ids, from, to])).rows;
    return { point: { id: point.id, name: point.name, metric: point.metric, unit: point.unit, maxAgeMs: point.max_age_ms, maxGapMs: point.max_gap_ms, timingSource: point.timing_source }, items, current, dataState,
        communication: { state: !currentReadable ? 'unknown' : health?.state === 'ok' ? 'last_contact_succeeded' : health?.state ?? 'unknown', lastAttemptAt: currentReadable ? health?.last_attempt_at ?? null : null, lastSuccessAt: currentReadable ? health?.last_success_at ?? null : null }, gaps,
        maintenance, manualChecks, nextCursor: more && last ? Buffer.from(JSON.stringify({ time: last.sampled_at.toISOString(), id: last.id })).toString('base64url') : null };
}
