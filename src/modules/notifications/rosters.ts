import type { PoolClient } from 'pg';
import type { Actor } from '../../platform/types';
import { AppError } from '../../platform/error';
import { choice, integer, text, time } from '../../platform/validation';
import { assertAccess, listAccessibleObjects } from '../identity/access';
import { requireAdmin } from '../identity/management';
import { audit, uuid } from '../identity/common';
import { encryptSecret, decryptSecret } from '../identity/mfa';
export async function currentRoster(c: PoolClient, objectId: string, at: Date) {
    const rows = (await c.query('SELECT * FROM duty_rosters WHERE object_id=$1 AND starts_at<=$2 AND ends_at>$2 AND verified AND cancelled_at IS NULL', [objectId, at])).rows;
    if (rows.length > 1)
        throw new AppError(409, 'ROSTER_CONFLICT', '同一对象存在冲突的值班安排');
    return rows[0] ?? null;
}
export async function recipientAllowed(c: PoolClient, userId: string, objectId: string): Promise<boolean> {
    return !!(await c.query(`SELECT 1 FROM users u JOIN grants g ON g.user_id=u.id WHERE u.id=$1 AND u.enabled AND g.object_id=$2 AND g.action='read'
    AND g.revoked_at IS NULL AND g.starts_at<=clock_timestamp() AND (g.expires_at IS NULL OR g.expires_at>clock_timestamp()) LIMIT 1`, [userId, objectId])).rowCount;
}
export async function saveRoster(c: PoolClient, actor: Actor, b: Record<string, unknown>) {
    uuid(b.objectId);
    await assertAccess(c, actor, { objectId: b.objectId, action: 'configure', at: new Date().toISOString() });
    const starts = time(b.startsAt), ends = time(b.endsAt);
    if (ends <= starts || b.verified !== true)
        throw new AppError(422, 'ROSTER_NOT_VERIFIED', '请核对起止时间、值班人员与通知资料后确认');
    if (typeof b.nightShift !== 'boolean')
        throw new AppError(400, 'NIGHT_SHIFT_REQUIRED', '请明确是否为夜班');
    const people = [b.onsiteId, b.technicianId, b.ownerId, b.maintainerId];
    for (const id of people) {
        uuid(id);
        if (!await recipientAllowed(c, id, b.objectId))
            throw new AppError(422, 'RECIPIENT_SCOPE', '值班与升级联系人须为已启用且有该对象查看权限的账号');
    }
    const roleGroups = [['worker', 'technician', 'owner'], ['technician', 'owner'], ['owner'], ['maintainer', 'technician', 'owner']];
    for (let i = 0; i < people.length; i++) {
        const user = (await c.query('SELECT role FROM users WHERE id=$1', [people[i]])).rows[0];
        if (!roleGroups[i].includes(user.role))
            throw new AppError(422, 'DUTY_ROLE_MISMATCH', '值班职责与人员角色不匹配');
    }
    await c.query('SELECT id FROM objects WHERE id=$1 FOR UPDATE', [b.objectId]);
    if ((await c.query("SELECT 1 FROM duty_rosters WHERE object_id=$1 AND cancelled_at IS NULL AND verified AND tstzrange(starts_at,ends_at,'[)') && tstzrange($2::timestamptz,$3::timestamptz,'[)')", [b.objectId, starts, ends])).rowCount)
        throw new AppError(409, 'ROSTER_OVERLAP', '该时段已有值班安排，请先撤销旧安排');
    const row = (await c.query(`INSERT INTO duty_rosters(object_id,starts_at,ends_at,night_shift,onsite_id,technician_id,owner_id,maintainer_id,call_timeout_ms,verified,evidence,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$11) RETURNING id`, [b.objectId, starts, ends, b.nightShift, ...people, b.nightShift ? integer(b.callTimeoutMs, '已核实呼叫等待时限', 1000, 600000) : null, text(b.evidence, '值班及等待时限依据', 2000), actor.id])).rows[0];
    await audit(c, actor.id, 'roster_created', row.id);
    return row;
}
export async function cancelRoster(c: PoolClient, actor: Actor, id: string) { uuid(id); const row = (await c.query('SELECT object_id FROM duty_rosters WHERE id=$1', [id])).rows[0]; if (!row)
    throw new AppError(404, 'ROSTER_NOT_FOUND', '值班安排不存在'); await assertAccess(c, actor, { objectId: row.object_id, action: 'configure', at: new Date().toISOString() }); await c.query('UPDATE duty_rosters SET cancelled_at=clock_timestamp() WHERE id=$1', [id]); await audit(c, actor.id, 'roster_cancelled', id); return { id, cancelled: true }; }
export async function listRosters(c: PoolClient, actor: Actor) {
    const ids = await listAccessibleObjects(c, actor, 'read');
    return (await c.query(`SELECT r.*,o.name AS object_name,u.display_name AS onsite_name,t.display_name AS technician_name,w.display_name AS owner_name,m.display_name AS maintainer_name FROM duty_rosters r
  JOIN objects o ON o.id=r.object_id JOIN users u ON u.id=r.onsite_id JOIN users t ON t.id=r.technician_id JOIN users w ON w.id=r.owner_id JOIN users m ON m.id=r.maintainer_id WHERE r.object_id=ANY($1::uuid[]) ORDER BY r.starts_at DESC LIMIT 200`, [ids])).rows;
}
export async function saveContact(c: PoolClient, actor: Actor, b: Record<string, unknown>) {
    await requireAdmin(c, actor);
    uuid(b.userId);
    const channel = choice(b.channel, ['wecom', 'voice'] as const, '通道'), address = text(b.address, '通知地址', 256);
    if (channel === 'voice' && !/^\+?\d{7,15}$/.test(address))
        throw new AppError(400, 'INVALID_PHONE', '手机号格式不正确');
    if (b.verified !== true)
        throw new AppError(422, 'CONTACT_UNVERIFIED', '请确认联系人资料与接入用途');
    await c.query(`INSERT INTO notification_contacts(user_id,channel,encrypted_address,verified,evidence,updated_by) VALUES($1,$2,$3,true,$4,$5)
    ON CONFLICT(user_id,channel) DO UPDATE SET encrypted_address=excluded.encrypted_address,verified=true,evidence=excluded.evidence,updated_by=excluded.updated_by,updated_at=clock_timestamp()`, [b.userId, channel, encryptSecret(address, b.userId + ':' + channel), text(b.evidence, '联系方式核实依据', 1000), actor.id]);
    await audit(c, actor.id, 'notification_contact_saved', b.userId);
    return { userId: b.userId, channel, verified: true };
}
export async function resolveContact(c: PoolClient, userId: string, channel: 'wecom' | 'voice', key?: string): Promise<string> {
    const row = (await c.query('SELECT encrypted_address FROM notification_contacts WHERE user_id=$1 AND channel=$2 AND verified', [userId, channel])).rows[0];
    if (!row)
        throw new AppError(503, 'CONTACT_NOT_READY', '通知联系人尚未核实');
    return decryptSecret(row.encrypted_address, userId + ':' + channel, key);
}
