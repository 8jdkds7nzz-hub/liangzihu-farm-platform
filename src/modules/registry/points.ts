import type { PoolClient } from 'pg';
import type { Actor } from '../../platform/types';
import { AppError } from '../../platform/error';
import { integer, text, time } from '../../platform/validation';
import { assertAccess } from '../identity/access';
import { audit, uuid } from '../identity/common';
export async function savePoint(c: PoolClient, actor: Actor, input: Record<string, unknown>) {
    uuid(input.deviceId);
    const device = (await c.query('SELECT object_id FROM devices WHERE id=$1', [input.deviceId])).rows[0];
    if (!device)
        throw new AppError(422, 'DEVICE_REQUIRED', '请先登记设备');
    await assertAccess(c, actor, { objectId: device.object_id, action: 'configure', at: new Date().toISOString() });
    const configured = input.maxAgeMs !== undefined && input.maxAgeMs !== null;
    const result = await c.query(`INSERT INTO points(device_id,code,name,metric,unit,max_age_ms,max_gap_ms,timing_source,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(code) DO NOTHING RETURNING *`, [input.deviceId, text(input.code, '测点编号', 80), text(input.name, '测点名称', 80), text(input.metric, '指标代号', 80), text(input.unit, '单位', 40), configured ? integer(input.maxAgeMs, '新鲜度时限') : null, configured ? integer(input.maxGapMs, '最大采样间隔') : null, configured ? text(input.timingSource, '时效依据', 1000) : null, actor.id]);
    if (!result.rowCount)
        throw new AppError(409, 'POINT_EXISTS', '测点编号已存在');
    await audit(c, actor.id, 'point_created', result.rows[0].id);
    return result.rows[0];
}
export async function bindPoint(c: PoolClient, actor: Actor, input: Record<string, unknown>) {
    uuid(input.pointId);
    uuid(input.objectId);
    const point = (await c.query('SELECT p.id,d.object_id FROM points p JOIN devices d ON d.id=p.device_id WHERE p.id=$1 FOR UPDATE OF p', [input.pointId])).rows[0];
    if (!point)
        throw new AppError(404, 'POINT_NOT_FOUND', '测点不存在');
    for (const objectId of new Set([point.object_id, input.objectId]))
        await assertAccess(c, actor, { objectId, action: 'configure', at: new Date().toISOString() });
    const from = time(input.validFrom), to = input.validTo ? time(input.validTo) : null;
    if (to && to <= from)
        throw new AppError(422, 'INVALID_PERIOD', '绑定结束时间须晚于开始时间');
    if (input.endPrevious === true) {
        if ((await c.query('SELECT 1 FROM rule_bindings WHERE point_id=$1 AND object_id<>$2 AND enabled', [input.pointId, input.objectId])).rowCount)
            throw new AppError(409, 'ACTIVE_RULE_BINDING', '换塘前须停用旧对象的规则并完成配置核对');
        if ((await c.query('SELECT 1 FROM observations WHERE point_id=$1 AND sampled_at>=$2 LIMIT 1', [input.pointId, from])).rowCount)
            throw new AppError(409, 'HISTORICAL_BINDING', '该时间之后已有测值，不能改写历史绑定区间');
        const old = (await c.query('SELECT * FROM point_bindings WHERE point_id=$1 AND valid_to IS NULL FOR UPDATE', [input.pointId])).rows;
        for (const row of old) {
            await assertAccess(c, actor, { objectId: row.object_id, action: 'configure', at: from });
            if (row.valid_from.toISOString() >= from)
                throw new AppError(409, 'BINDING_CONFLICT', '新绑定不能早于现有绑定');
        }
        await c.query('UPDATE point_bindings SET valid_to=$2 WHERE point_id=$1 AND valid_to IS NULL', [input.pointId, from]);
    }
    const overlap = await c.query("SELECT 1 FROM point_bindings WHERE point_id=$1 AND tstzrange(valid_from,valid_to,'[)') && tstzrange($2::timestamptz,$3::timestamptz,'[)')", [input.pointId, from, to]);
    if (overlap.rowCount)
        throw new AppError(409, 'BINDING_CONFLICT', '同一时段已有测点绑定');
    const row = (await c.query('INSERT INTO point_bindings(point_id,object_id,valid_from,valid_to,verified,evidence,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *', [input.pointId, input.objectId, from, to, input.verified === true, text(input.evidence, '核实依据', 1000), actor.id])).rows[0];
    await audit(c, actor.id, 'point_bound', row.id);
    return row;
}
export async function resolvePointBinding(c: PoolClient, pointId: string, sampledAt: string): Promise<{
    objectId: string;
    bindingId: string;
    verified: boolean;
} | null> {
    uuid(pointId);
    time(sampledAt);
    const rows = (await c.query('SELECT id,object_id,verified FROM point_bindings WHERE point_id=$1 AND valid_from<=$2 AND (valid_to IS NULL OR $2<valid_to) ORDER BY valid_from DESC', [pointId, sampledAt])).rows;
    if (rows.length > 1)
        throw new AppError(409, 'BINDING_CONFLICT', '该采样时点有多个绑定，需核查');
    return rows.length ? { objectId: rows[0].object_id, bindingId: rows[0].id, verified: rows[0].verified } : null;
}
