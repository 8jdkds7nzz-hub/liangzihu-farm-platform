import type { PoolClient } from 'pg';
import type { Action, Actor, Role, Scope } from '../../platform/types';
import { denied, digest, uuid } from './common';

export const roleActions: Record<Role, readonly Action[]> = {
  admin: ['read', 'configure', 'share', 'export'],
  owner: ['read', 'record', 'claim', 'close_alert', 'review', 'dispatch', 'share', 'configure', 'export', 'act'],
  technician: ['read', 'record', 'claim', 'close_alert', 'review', 'dispatch', 'share', 'configure', 'export', 'act'],
  worker: ['read', 'record', 'claim', 'close_alert', 'act'],
  maintainer: ['read', 'record', 'claim', 'configure', 'export', 'act'],
  expert: ['read', 'review', 'export'],
};
export async function requiresMfa(client: PoolClient, userId: string): Promise<boolean> {
  return (await client.query(`SELECT (u.role='admin' OR EXISTS(SELECT 1 FROM second_factors f WHERE f.user_id=u.id)
    OR EXISTS(SELECT 1 FROM grants g WHERE g.user_id=u.id AND g.action IN ('configure','act')
      AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>clock_timestamp()))) AS needed
    FROM users u WHERE u.id=$1`, [userId])).rows[0]?.needed ?? true;
}
async function checkActor(client: PoolClient, actor: Actor, action: Action): Promise<void> {
  uuid(actor.id);
  const current = (await client.query('SELECT role,enabled FROM users WHERE id=$1', [actor.id])).rows[0];
  if (!actor.enabled || !current?.enabled || current.role !== actor.role || !roleActions[actor.role]?.includes(action)) throw denied();
  if (!actor.mfaVerified && await requiresMfa(client, actor.id)) throw denied();
}
export async function listAccessibleObjects(client: PoolClient, actor: Actor, action: Action): Promise<string[]> {
  await checkActor(client, actor, action);
  const result = await client.query(`SELECT DISTINCT object_id FROM grants WHERE user_id=$1 AND action=$2
    AND revoked_at IS NULL AND starts_at<=clock_timestamp() AND (expires_at IS NULL OR expires_at>clock_timestamp()) ORDER BY object_id`, [actor.id, action]);
  return result.rows.map(row => row.object_id);
}
export async function assertAccess(client: PoolClient, actor: Actor, scope: Scope): Promise<void> {
  uuid(scope.objectId);
  await checkActor(client, actor, scope.action);
  // scope.at describes business time. Authorization always uses server time.
  const result = await client.query(`SELECT 1 FROM grants WHERE user_id=$1 AND object_id=$2 AND action=$3
    AND revoked_at IS NULL AND starts_at<=clock_timestamp() AND (expires_at IS NULL OR expires_at>clock_timestamp()) LIMIT 1`, [actor.id, scope.objectId, scope.action]);
  if (!result.rowCount) throw denied();
}
export async function assertIntegrationAccess(client: PoolClient, token: string, scope: Scope): Promise<void> {
  uuid(scope.objectId);
  if (!/^[a-f0-9]{64}$/.test(token)) throw denied();
  const result = await client.query(`SELECT 1 FROM integration_tokens t JOIN users u ON u.id=t.created_by
    WHERE t.token_hash=$1 AND t.object_id=$2 AND t.action=$3 AND t.revoked_at IS NULL
      AND t.expires_at>clock_timestamp() AND u.enabled AND u.role='admin'`, [digest(token), scope.objectId, scope.action]);
  if (!result.rowCount) throw denied();
}
