import { createHash, randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Clock } from '../../platform/types';
import { AppError } from '../../platform/error';

export interface IdentityOptions { pool?: Pool; clock?: Clock; encryptionKey?: string }
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const newToken = () => randomBytes(32).toString('hex');
export const now = (options: IdentityOptions) => options.clock?.now() ?? new Date();
export const denied = () => new AppError(403, 'ACCESS_DENIED', '没有此对象或操作的权限');
export const unauthenticated = () => new AppError(401, 'AUTH_REQUIRED', '请重新登录');
export const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', '账号或验证信息不正确');
export function uuid(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) {
    throw new AppError(400, 'INVALID_ID', '对象或账号编号无效');
  }
}
export async function audit(client: PoolClient, actorId: string | null, type: string, targetId?: string) {
  await client.query('INSERT INTO audit_events(actor_id,event_type,target_id) VALUES($1,$2,$3)', [actorId, type, targetId ?? null]);
}
