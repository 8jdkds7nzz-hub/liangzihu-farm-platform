import type { PoolClient } from 'pg';
import type { Actor } from '../../platform/types';
import { AppError } from '../../platform/error';
import { choice, text } from '../../platform/validation';
import { assertAccess } from '../identity/access';
import { uuid, digest } from '../identity/common';
import { canonicalJson } from '../../platform/json';
export async function createWorkOrder(c: PoolClient, actor: Actor, b: Record<string, unknown>) {
    uuid(b.objectId);
    await assertAccess(c, actor, { objectId: b.objectId, action: 'record', at: new Date().toISOString() });
    const fault = text(b.fault, '故障与依据', 4000), key = text(b.requestKey, '请求标识', 100), role = choice(b.responsibleRole, ['maintainer', 'technician'] as const, '负责岗位');
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['work-order-create:' + actor.id + ':' + key]);
    const prior = (await c.query('SELECT * FROM work_orders WHERE created_by=$1 AND request_key=$2', [actor.id, key])).rows[0];
    if (prior) {
        if (prior.object_id !== b.objectId || prior.fault !== fault || prior.responsible_role !== role)
            throw new AppError(409, 'REQUEST_KEY_CONFLICT', '工单请求标识冲突');
        return prior;
    }
    const row = (await c.query('INSERT INTO work_orders(object_id,fault,responsible_role,created_by,request_key) VALUES($1,$2,$3,$4,$5) RETURNING *', [b.objectId, fault, role, actor.id, key])).rows[0];
    await c.query("INSERT INTO work_order_events(work_order_id,state,note,actor_id) VALUES($1,'open',$2,$3)", [row.id, fault, actor.id]);
    return row;
}
export async function updateWorkOrder(c: PoolClient, actor: Actor, b: Record<string, unknown>) {
    const key = text(b.requestKey, '请求标识', 100), note = text(b.note, '处理或复核依据', 4000);
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['work-order-update:' + actor.id + ':' + key]);
    uuid(b.id);
    const row = (await c.query('SELECT * FROM work_orders WHERE id=$1 FOR UPDATE', [b.id])).rows[0];
    if (!row)
        throw new AppError(404, 'WORK_ORDER_NOT_FOUND', '工单不存在');
    const next = choice(b.state, ['assigned', 'handled', 'reviewed'] as const, '工单状态'), expected = { assigned: 'open', handled: 'assigned', reviewed: 'handled' }[next];
    await assertAccess(c, actor, { objectId: row.object_id, action: next === 'assigned' ? 'dispatch' : next === 'reviewed' ? 'review' : 'record', at: new Date().toISOString() });
    const hash = digest(canonicalJson({ id: row.id, state: next, note, assignedTo: b.assignedTo ?? null }));
    const prior = (await c.query("SELECT details FROM audit_events WHERE actor_id=$1 AND event_type='work_order_updated' AND details->>'requestKey'=$2", [actor.id, key])).rows[0];
    if (prior) {
        if (prior.details.payloadHash !== hash)
            throw new AppError(409, 'REQUEST_KEY_CONFLICT', '工单操作标识对应内容不同');
        return { id: row.id, state: row.state };
    }
    if (row.state !== expected)
        throw new AppError(409, 'WORK_ORDER_STATE', '工单状态已变化，请刷新后继续');
    let assigned = row.assigned_to;
    if (next === 'assigned') {
        uuid(b.assignedTo);
        assigned = b.assignedTo;
        const user = (await c.query('SELECT enabled,role FROM users WHERE id=$1', [assigned])).rows[0];
        if (!user?.enabled || ![row.responsible_role, 'technician', 'owner'].includes(user.role))
            throw new AppError(422, 'ASSIGNEE_ROLE', '接单人岗位不匹配');
        if (!(await c.query("SELECT 1 FROM grants WHERE user_id=$1 AND object_id=$2 AND action='record' AND revoked_at IS NULL AND starts_at<=clock_timestamp() AND (expires_at IS NULL OR expires_at>clock_timestamp())", [assigned, row.object_id])).rowCount)
            throw new AppError(422, 'ASSIGNEE_SCOPE', '接单人尚无该对象记录权限');
    }
    if (next === 'handled' && assigned !== actor.id)
        throw new AppError(403, 'NOT_ASSIGNED', '仅当前指定人员可提交处理结果');
    await c.query('UPDATE work_orders SET state=$2,assigned_to=$3 WHERE id=$1', [row.id, next, assigned]);
    await c.query('INSERT INTO work_order_events(work_order_id,state,note,actor_id) VALUES($1,$2,$3,$4)', [row.id, next, note, actor.id]);
    await c.query("INSERT INTO audit_events(actor_id,event_type,target_id,details) VALUES($1,'work_order_updated',$2,$3)", [actor.id, row.id, { requestKey: key, payloadHash: hash }]);
    return { id: row.id, state: next };
}
