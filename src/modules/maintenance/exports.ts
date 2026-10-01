import type { PoolClient } from 'pg';
import type { Actor } from '../../platform/types';
import { AppError } from '../../platform/error';
import { time } from '../../platform/validation';
import { assertAccess } from '../identity/access';
import { audit, digest, uuid } from '../identity/common';
import { canonicalJson } from '../../platform/json';
async function rows(c: PoolClient, sql: string, params: unknown[]) { const r = (await c.query(sql + ' LIMIT 5001', params)).rows; if (r.length > 5000)
    throw new AppError(422, 'EXPORT_TOO_LARGE', '该范围超过单次导出上限，请缩小对象或时间范围'); return r; }
async function chains(c: PoolClient, table: 'maintenance_records' | 'manual_checks', ids: unknown[], from: string, to: string) {
    return rows(c, `WITH RECURSIVE chain AS (
  SELECT * FROM ${table} WHERE object_id=ANY($1::uuid[]) AND occurred_at>=$2 AND occurred_at<$3
  UNION SELECT p.* FROM ${table} p JOIN chain n ON p.id=n.supersedes_id OR p.supersedes_id=n.id WHERE p.object_id=ANY($1::uuid[])
) SELECT * FROM chain ORDER BY occurred_at,id`, [ids, from, to]);
}
export async function createExport(c: PoolClient, actor: Actor, b: Record<string, unknown>) {
    const ids = Array.isArray(b.objectIds) ? b.objectIds : [b.objectId];
    if (!ids.length || ids.length > 20)
        throw new AppError(400, 'EXPORT_SCOPE', '一次选择1至20个对象');
    for (const id of ids) {
        uuid(id);
        await assertAccess(c, actor, { objectId: id, action: 'export', at: new Date().toISOString() });
    }
    const from = time(b.from), to = time(b.to);
    if (from >= to || Date.parse(to) - Date.parse(from) > 31 * 86400000)
        throw new AppError(400, 'EXPORT_PERIOD', '导出时间须为正且不超过31天');
    const observations = await rows(c, `SELECT o.*,h.conflicted,(h.canonical_id=o.id) AS canonical FROM observations o JOIN observation_heads h ON h.id=o.head_id WHERE object_id=ANY($1::uuid[]) AND sampled_at>=$2 AND sampled_at<$3 ORDER BY sampled_at,o.id`, [ids, from, to]);
    const maintenance = await chains(c, 'maintenance_records', ids, from, to);
    const manualChecks = await chains(c, 'manual_checks', ids, from, to);
    const bindings = await rows(c, 'SELECT * FROM point_bindings WHERE object_id=ANY($1::uuid[]) ORDER BY valid_from,id', [ids]);
    const pointIds = [...new Set([...observations.map(r => r.point_id), ...bindings.map(r => r.point_id), ...maintenance.map(r => r.point_id), ...manualChecks.map(r => r.point_id)].filter(Boolean))];
    const points = await rows(c, 'SELECT * FROM points WHERE id=ANY($1::uuid[])', [pointIds]);
    const devices = await rows(c, 'SELECT * FROM devices WHERE id=ANY($1::uuid[])', [points.map(p => p.device_id)]);
    const alerts = await rows(c, 'SELECT * FROM alerts WHERE object_id=ANY($1::uuid[]) ORDER BY opened_at,id', [ids]);
    const rules = await rows(c, 'SELECT v.* FROM rule_versions v JOIN rule_bindings b ON b.id=v.binding_id WHERE b.object_id=ANY($1::uuid[])', [ids]);
    const workOrders = await rows(c, 'SELECT * FROM work_orders WHERE object_id=ANY($1::uuid[])', [ids]);
    const payload = { schemaVersion: '1a-v1', exportedAt: new Date().toISOString(), scope: { objectIds: ids, from, to }, limits: { measurements: '测值和维护按时段，附相关更正链；配置保留关系，最多各5000条', rawBodies: '不含原报文正文；完整原始字节由数据库备份保留', externalReferences: '范围外父对象、父设备及人员仅保留ID引用；不会导出其未授权资料' },
        objects: await rows(c, 'SELECT id,parent_id,code,name,kind,boundary_status,source,version FROM objects WHERE id=ANY($1::uuid[])', [ids]),
        objectVersions: await rows(c, 'SELECT * FROM object_versions WHERE object_id=ANY($1::uuid[])', [ids]), points, devices, bindings, observations,
        batches: await rows(c, 'SELECT * FROM production_batches WHERE object_id=ANY($1::uuid[])', [ids]), rules,
        ruleBindings: await rows(c, 'SELECT * FROM rule_bindings WHERE object_id=ANY($1::uuid[])', [ids]), alerts,
        alertEvents: await rows(c, 'SELECT * FROM alert_events WHERE alert_id=ANY($1::uuid[])', [alerts.map(a => a.id)]), maintenance, manualChecks, workOrders,
        workOrderEvents: await rows(c, 'SELECT * FROM work_order_events WHERE work_order_id=ANY($1::uuid[])', [workOrders.map(w => w.id)]),
        rawReferences: await rows(c, 'SELECT id,source_id,received_at,sha256,octet_length(body) AS byte_length,synthetic,contract_version,contract_ref,contract_sha256 FROM raw_receipts WHERE id=ANY($1::uuid[])', [[...new Set(observations.map(o => o.raw_ref))]]),
        sources: await rows(c, 'SELECT id,code,name,provider,verified FROM data_sources WHERE id=ANY($1::uuid[])', [[...new Set(devices.map(d => d.source_id))]]) };
    const encoded = canonicalJson(payload);
    if (Buffer.byteLength(encoded) > 8 * 1024 * 1024)
        throw new AppError(422, 'EXPORT_TOO_LARGE', '导出超过8MB，请缩小范围');
    const row = (await c.query('INSERT INTO export_tasks(created_by,object_ids,from_at,to_at,payload,sha256) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,expires_at', [actor.id, ids, from, to, payload, digest(encoded)])).rows[0];
    await audit(c, actor.id, 'export_created', row.id);
    return { ...row, state: 'ready', downloadUrl: '/api/v1/exports/' + row.id };
}
export async function downloadExport(c: PoolClient, actor: Actor, id: string) {
    uuid(id);
    const row = (await c.query('SELECT * FROM export_tasks WHERE id=$1 AND created_by=$2 AND expires_at>clock_timestamp()', [id, actor.id])).rows[0];
    if (!row)
        throw new AppError(404, 'EXPORT_NOT_FOUND', '导出不存在、已过期或不属于此账号');
    for (const objectId of row.object_ids)
        await assertAccess(c, actor, { objectId, action: 'export', at: new Date().toISOString() });
    const body = canonicalJson(row.payload);
    if (digest(body) !== row.sha256)
        throw new AppError(503, 'EXPORT_INTEGRITY', '导出内容校验失败，请重新生成');
    await audit(c, actor.id, 'export_downloaded', id);
    return { body, sha256: row.sha256 };
}
