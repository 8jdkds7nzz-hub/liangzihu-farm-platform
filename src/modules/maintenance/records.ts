import type { PoolClient } from 'pg';
import type { Actor } from '../../platform/types';
import { AppError } from '../../platform/error';
import { choice, finite, optionalText, text, time } from '../../platform/validation';
import { assertAccess, listAccessibleObjects } from '../identity/access';
import { audit, uuid } from '../identity/common';
import { resolvePointBinding } from '../registry/points';
async function recordScope(c: PoolClient, actor: Actor, b: Record<string, unknown>) {
    uuid(b.objectId);
    await assertAccess(c, actor, { objectId: b.objectId, action: 'record', at: new Date().toISOString() });
    const at = time(b.occurredAt);
    let pointId: string | null = null;
    if (b.pointId !== undefined && b.pointId !== null && b.pointId !== '') {
        uuid(b.pointId);
        pointId = b.pointId;
        const binding = await resolvePointBinding(c, pointId, at);
        if (!binding?.verified || binding.objectId !== b.objectId)
            throw new AppError(422, 'RECORD_POINT_SCOPE', '此发生时点的测点对象对应尚未核实');
    }
    const key = text(b.requestKey, '请求标识', 100);
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['field-record:' + actor.id + ':' + key]);
    return { objectId: b.objectId, pointId, at, key, source: text(b.source, '来源与依据', 2000) };
}
async function correction(c: PoolClient, table: 'maintenance_records' | 'manual_checks', id: unknown, objectId: string, pointId: string | null) {
    if (!id)
        return null;
    uuid(id);
    const old = (await c.query(`SELECT object_id,point_id FROM ${table} WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!old || old.object_id !== objectId || old.point_id !== pointId)
        throw new AppError(422, 'INVALID_CORRECTION', '更正须引用同一对象与测点的记录');
    if ((await c.query(`SELECT 1 FROM ${table} WHERE supersedes_id=$1`, [id])).rowCount)
        throw new AppError(409, 'ALREADY_CORRECTED', '原记录已被更正，请引用最新更正记录');
    return id;
}
export async function recordMaintenance(c: PoolClient, actor: Actor, b: Record<string, unknown>) {
    const scope = await recordScope(c, actor, b), recordType = choice(b.recordType, ['cleaning', 'calibration', 'replacement', 'installation', 'repair'] as const, '维护类型');
    const payload = { description: text(b.description, '维护内容与结果', 4000), parameter: optionalText(b.parameter, '参数名称', 100), before: optionalText(b.before, '原参数', 100), after: optionalText(b.after, '调整后参数', 100), unit: optionalText(b.unit, '单位', 40) };
    if (recordType === 'calibration' && (!payload.parameter || !payload.before || !payload.after || !payload.unit))
        throw new AppError(422, 'CALIBRATION_DETAILS', '校准须记录参数、原值、调整值和单位');
    const prior = (await c.query('SELECT *,payload=$3::jsonb AS same FROM maintenance_records WHERE recorded_by=$1 AND request_key=$2', [actor.id, scope.key, JSON.stringify(payload)])).rows[0];
    if (prior) {
        if (prior.object_id !== scope.objectId || prior.point_id !== scope.pointId || prior.record_type !== recordType || prior.occurred_at.toISOString() !== scope.at || prior.source !== scope.source || !prior.same || prior.supersedes_id !== (b.supersedesId || null))
            throw new AppError(409, 'REQUEST_KEY_CONFLICT', '维护记录标识对应内容不同');
        return prior;
    }
    const supersedes = await correction(c, 'maintenance_records', b.supersedesId, scope.objectId, scope.pointId);
    const row = (await c.query('INSERT INTO maintenance_records(object_id,point_id,occurred_at,record_type,payload,source,supersedes_id,recorded_by,request_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *', [scope.objectId, scope.pointId, scope.at, recordType, payload, scope.source, supersedes, actor.id, scope.key])).rows[0];
    await audit(c, actor.id, 'maintenance_recorded', row.id);
    return row;
}
export async function recordManualCheck(c: PoolClient, actor: Actor, b: Record<string, unknown>) {
    const scope = await recordScope(c, actor, b), metric = text(b.metric, '指标', 80), raw = text(String(b.rawValue ?? ''), '原始读数', 100), unit = text(b.unit, '单位', 40), method = text(b.method, '仪器或方法', 500);
    const value = b.value === null || b.value === undefined ? null : finite(b.value, '复测值');
    const prior = (await c.query('SELECT * FROM manual_checks WHERE recorded_by=$1 AND request_key=$2', [actor.id, scope.key])).rows[0];
    if (prior) {
        if (prior.object_id !== scope.objectId || prior.point_id !== scope.pointId || prior.raw_value !== raw || prior.metric !== metric || prior.unit !== unit || prior.method !== method || prior.source !== scope.source || prior.occurred_at.toISOString() !== scope.at || (prior.value === null ? null : Number(prior.value)) !== value || prior.supersedes_id !== (b.supersedesId || null))
            throw new AppError(409, 'REQUEST_KEY_CONFLICT', '复测记录标识对应内容不同');
        return prior;
    }
    const supersedes = await correction(c, 'manual_checks', b.supersedesId, scope.objectId, scope.pointId);
    const row = (await c.query('INSERT INTO manual_checks(object_id,point_id,occurred_at,metric,raw_value,value,unit,method,source,supersedes_id,recorded_by,request_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *', [scope.objectId, scope.pointId, scope.at, metric, raw, value, unit, method, scope.source, supersedes, actor.id, scope.key])).rows[0];
    await audit(c, actor.id, 'manual_check_recorded', row.id);
    return row;
}
export async function listMaintenance(c: PoolClient, actor: Actor) { const ids = await listAccessibleObjects(c, actor, 'read'); return { maintenance: (await c.query('SELECT m.*,o.name AS object_name,u.display_name AS recorder_name FROM maintenance_records m JOIN objects o ON o.id=m.object_id JOIN users u ON u.id=m.recorded_by WHERE m.object_id=ANY($1::uuid[]) ORDER BY m.recorded_at DESC LIMIT 200', [ids])).rows, manual: (await c.query('SELECT m.*,o.name AS object_name,u.display_name AS recorder_name FROM manual_checks m JOIN objects o ON o.id=m.object_id JOIN users u ON u.id=m.recorded_by WHERE m.object_id=ANY($1::uuid[]) ORDER BY m.recorded_at DESC LIMIT 200', [ids])).rows }; }
