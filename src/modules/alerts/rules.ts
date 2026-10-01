import type { PoolClient } from 'pg';
import type { Actor } from '../../platform/types';
import { AppError } from '../../platform/error';
import { choice, finite, integer, text, time } from '../../platform/validation';
import { assertAccess, listAccessibleObjects } from '../identity/access';
import { audit, uuid } from '../identity/common';
import { resolvePointBinding } from '../registry/points';
import type { RuleVersion } from './evaluate';
export function ruleFromRow(r: Record<string, any>): RuleVersion { return { id: r.id, version: r.version, metric: r.metric, unit: r.unit, comparison: r.comparison, threshold: Number(r.threshold), durationMs: r.duration_ms, maxGapMs: r.max_gap_ms, maxAgeMs: r.max_age_ms, severity: r.severity, approvedBy: r.approved_by, effectiveFrom: r.effective_from.toISOString(), effectiveTo: r.effective_to?.toISOString() ?? null }; }
export async function createRule(c: PoolClient, actor: Actor, b: Record<string, unknown>, at = new Date()) {
    uuid(b.objectId);
    uuid(b.pointId);
    uuid(b.batchId);
    await assertAccess(c, actor, { objectId: b.objectId, action: 'configure', at: at.toISOString() });
    const batch = (await c.query('SELECT * FROM production_batches WHERE id=$1 AND object_id=$2 AND verified', [b.batchId, b.objectId])).rows[0];
    if (!batch)
        throw new AppError(422, 'BATCH_NOT_VERIFIED', '须先核实该对象的物种与阶段批次');
    const binding = await resolvePointBinding(c, b.pointId, at.toISOString());
    if (!binding?.verified || binding.objectId !== b.objectId)
        throw new AppError(422, 'POINT_NOT_VERIFIED', '测点与对象尚未核实');
    const point = (await c.query('SELECT metric,unit FROM points WHERE id=$1', [b.pointId])).rows[0];
    const effectiveFrom = time(b.effectiveFrom), effectiveTo = b.effectiveTo ? time(b.effectiveTo) : null;
    if (effectiveTo && effectiveTo <= effectiveFrom)
        throw new AppError(422, 'INVALID_PERIOD', '规则有效期不正确');
    let bindingId: string;
    if (b.bindingId) {
        uuid(b.bindingId);
        const existing = (await c.query('SELECT * FROM rule_bindings WHERE id=$1 FOR UPDATE', [b.bindingId])).rows[0];
        if (!existing || existing.object_id !== b.objectId || existing.point_id !== b.pointId || existing.batch_id !== b.batchId)
            throw new AppError(422, 'RULE_BINDING_MISMATCH', '规则版本须保留原对象、测点与批次');
        bindingId = b.bindingId;
    }
    else
        bindingId = (await c.query('INSERT INTO rule_bindings(point_id,object_id,batch_id,name,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id', [b.pointId, b.objectId, b.batchId, text(b.name, '规则名称', 100), actor.id])).rows[0].id;
    const version = Number((await c.query('SELECT COALESCE(max(version),0)+1 AS next FROM rule_versions WHERE binding_id=$1', [bindingId])).rows[0].next);
    const row = (await c.query(`INSERT INTO rule_versions(binding_id,version,metric,unit,comparison,threshold,duration_ms,max_gap_ms,max_age_ms,severity,source,effective_from,effective_to,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id,version`, [bindingId, version, point.metric, point.unit, choice(b.comparison, ['lt', 'lte', 'gt', 'gte'] as const, '比较方式'), finite(b.threshold, '阈值'), integer(b.durationMs, '持续时长', 0), integer(b.maxGapMs, '最大间隔'), integer(b.maxAgeMs, '新鲜度'), choice(b.severity, ['info', 'warning', 'severe'] as const, '级别'), text(b.source, '专业依据', 2000), effectiveFrom, effectiveTo, actor.id])).rows[0];
    await audit(c, actor.id, 'rule_drafted', row.id);
    return { ...row, bindingId };
}
export async function approveRule(c: PoolClient, actor: Actor, id: string, evidence: string, at = new Date()) {
    uuid(id);
    const row = (await c.query('SELECT v.id,b.object_id FROM rule_versions v JOIN rule_bindings b ON b.id=v.binding_id WHERE v.id=$1', [id])).rows[0];
    if (!row)
        throw new AppError(404, 'RULE_NOT_FOUND', '规则不存在');
    await assertAccess(c, actor, { objectId: row.object_id, action: 'review', at: at.toISOString() });
    const result = await c.query('UPDATE rule_versions SET approved_by=$2,approved_at=$3,approval_evidence=$4 WHERE id=$1 AND approved_by IS NULL RETURNING id', [id, actor.id, at, text(evidence, '审核依据', 2000)]);
    if (!result.rowCount)
        throw new AppError(409, 'ALREADY_APPROVED', '规则已经审核，修改须另建版本');
    await audit(c, actor.id, 'rule_approved', id);
    return { id, approved: true };
}
export async function enableRule(c: PoolClient, actor: Actor, id: string, enabled: boolean, at = new Date()) {
    uuid(id);
    const r = (await c.query('SELECT v.*,b.object_id,b.active_version_id,b.enabled FROM rule_versions v JOIN rule_bindings b ON b.id=v.binding_id WHERE v.id=$1 FOR UPDATE OF b', [id])).rows[0];
    if (!r)
        throw new AppError(404, 'RULE_NOT_FOUND', '规则不存在');
    await assertAccess(c, actor, { objectId: r.object_id, action: 'configure', at: at.toISOString() });
    if (enabled && !r.approved_by)
        throw new AppError(422, 'APPROVAL_REQUIRED', '规则尚未经专业审核');
    if (enabled) {
        const binding = (await c.query('SELECT point_id,batch_id FROM rule_bindings WHERE id=$1', [r.binding_id])).rows[0];
        await c.query('SELECT id FROM points WHERE id=$1 FOR UPDATE', [binding.point_id]);
        const location = await resolvePointBinding(c, binding.point_id, at.toISOString());
        if (!location?.verified || location.objectId !== r.object_id)
            throw new AppError(422, 'POINT_NOT_VERIFIED', '启用前须重新核对当前测点与对象对应');
        if (!(await c.query('SELECT 1 FROM production_batches p WHERE p.id=$1 AND p.verified AND NOT EXISTS(SELECT 1 FROM production_batches newer WHERE newer.supersedes_id=p.id)', [binding.batch_id])).rowCount)
            throw new AppError(422, 'BATCH_NOT_VERIFIED', '原批次已更正或未核实，请建立适用新批次的规则');
    }
    if (r.enabled === enabled && (!enabled || r.active_version_id === id))
        return { id, enabled };
    if (enabled && r.active_version_id !== id && (await c.query("SELECT 1 FROM alerts WHERE rule_binding_id=$1 AND state<>'closed'", [r.binding_id])).rowCount)
        throw new AppError(409, 'OPEN_ALERTS', '旧版本还有未关闭事件，请先核查处置');
    await c.query('UPDATE rule_bindings SET enabled=$2,active_version_id=CASE WHEN $2 THEN $3 ELSE active_version_id END,enabled_at=CASE WHEN $2 THEN $4 ELSE enabled_at END WHERE id=$1', [r.binding_id, enabled, id, at]);
    await audit(c, actor.id, enabled ? 'rule_enabled' : 'rule_disabled', id);
    return { id, enabled };
}
export async function listRules(c: PoolClient, actor: Actor) { const ids = await listAccessibleObjects(c, actor, 'read'); return (await c.query(`SELECT v.*,b.name,b.object_id,b.point_id,b.batch_id,b.enabled,b.active_version_id FROM rule_versions v JOIN rule_bindings b ON b.id=v.binding_id WHERE b.object_id=ANY($1::uuid[]) ORDER BY v.created_at DESC`, [ids])).rows; }
