import type { PoolClient } from 'pg';
import type { Action, Actor, Role } from '../../platform/types';
import { AppError } from '../../platform/error';
import { audit, denied, digest, newToken, uuid } from './common';
import { roleActions } from './access';
import { hashPassword } from './password';

export async function requireAdmin(client: PoolClient, actor: Actor) {
  uuid(actor.id);
  const user = (await client.query('SELECT enabled,role FROM users WHERE id=$1', [actor.id])).rows[0];
  if (!actor.enabled || actor.role !== 'admin' || !actor.mfaVerified || !user?.enabled || user.role !== 'admin') throw denied();
}
export async function createUser(client: PoolClient, actor: Actor, input: { username: string; displayName: string; password: string; role: Role }) {
  await requireAdmin(client, actor);
  const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
  if (!/^[a-z0-9][a-z0-9_.@-]{2,79}$/.test(username) || typeof input.displayName !== 'string' || !input.displayName.trim() || input.displayName.length > 80 || !Object.hasOwn(roleActions, input.role)) {
    throw new AppError(400, 'INVALID_USER', '请检查账号、姓名和角色');
  }
  const hash = await hashPassword(input.password);
  const row = (await client.query(`INSERT INTO users(username,display_name,password_hash,role) VALUES($1,$2,$3,$4)
    ON CONFLICT(username) DO NOTHING RETURNING id`, [username, input.displayName.trim(), hash, input.role])).rows[0];
  if (!row) throw new AppError(409, 'USERNAME_EXISTS', '该账号已经存在');
  await audit(client, actor.id, 'user_created', row.id);
  return row.id as string;
}
export async function grantAccess(client: PoolClient, actor: Actor, input: { userId: string; objectId: string; action: Action; expiresAt?: string }) {
  await requireAdmin(client, actor);
  uuid(input.userId); uuid(input.objectId);
  const user = (await client.query('SELECT role,enabled FROM users WHERE id=$1', [input.userId])).rows[0];
  if (!user?.enabled || !roleActions[user.role as Role]?.includes(input.action)) throw denied();
  const expiry = input.expiresAt === undefined ? null : new Date(input.expiresAt);
  if (expiry && (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now())) throw new AppError(400, 'INVALID_EXPIRY', '授权到期时间必须晚于当前时间');
  const row = (await client.query('INSERT INTO grants(user_id,object_id,action,expires_at,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id', [input.userId, input.objectId, input.action, expiry, actor.id])).rows[0];
  await audit(client, actor.id, 'grant_created', row.id);
  return row.id as string;
}
export async function revokeGrant(client: PoolClient, actor: Actor, grantId: string) {
  await requireAdmin(client, actor); uuid(grantId);
  const result = await client.query('UPDATE grants SET revoked_at=clock_timestamp() WHERE id=$1 AND revoked_at IS NULL RETURNING id', [grantId]);
  if (result.rowCount) await audit(client, actor.id, 'grant_revoked', grantId);
}
export async function disableUser(client: PoolClient, actor: Actor, userId: string) {
  await requireAdmin(client, actor); uuid(userId);
  if (actor.id === userId) throw new AppError(400, 'SELF_DISABLE', '不能在当前会话停用自己');
  const result = await client.query('UPDATE users SET enabled=false WHERE id=$1 AND enabled RETURNING id', [userId]);
  if (!result.rowCount) return;
  await client.query('DELETE FROM sessions WHERE user_id=$1', [userId]);
  await client.query('UPDATE grants SET revoked_at=clock_timestamp() WHERE user_id=$1 AND revoked_at IS NULL', [userId]);
  await client.query('UPDATE integration_tokens SET revoked_at=clock_timestamp() WHERE created_by=$1 AND revoked_at IS NULL', [userId]);
  await audit(client, actor.id, 'user_disabled', userId);
}
export async function issueIntegrationToken(client: PoolClient, actor: Actor, input: { label: string; objectId: string; action: 'read' | 'record'; expiresAt: string }) {
  await requireAdmin(client, actor); uuid(input.objectId);
  const expires = new Date(input.expiresAt);
  if (!['read','record'].includes(input.action) || typeof input.label !== 'string' || !input.label.trim() || input.label.length > 80 || !Number.isFinite(expires.getTime()) || expires.getTime() <= Date.now()) {
    throw new AppError(400, 'INVALID_TOKEN_SCOPE', '接入凭据需要名称、对象、只读或记录权限及未来到期时间');
  }
  const token = newToken();
  const row = (await client.query(`INSERT INTO integration_tokens(label,token_hash,object_id,action,created_by,expires_at)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [input.label.trim(), digest(token), input.objectId, input.action, actor.id, expires])).rows[0];
  await audit(client, actor.id, 'integration_token_created', row.id);
  return { id: row.id as string, token };
}
export async function revokeIntegrationToken(client: PoolClient, actor: Actor, id: string) {
  await requireAdmin(client, actor); uuid(id);
  const result = await client.query('UPDATE integration_tokens SET revoked_at=clock_timestamp() WHERE id=$1 AND revoked_at IS NULL RETURNING id', [id]);
  if (result.rowCount) await audit(client, actor.id, 'integration_token_revoked', id);
}
