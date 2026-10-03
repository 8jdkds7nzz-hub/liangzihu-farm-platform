import type { PoolClient } from 'pg';
import { randomBytes } from 'node:crypto';
import type { Actor, Role } from '../../platform/types';
import { AppError } from '../../platform/error';
import { database, transaction } from '../../db/pool';
import { audit, digest, invalidCredentials, newToken, now, unauthenticated, type IdentityOptions } from './common';
import { requiresMfa } from './access';
import { dummyHash, verifyPassword } from './password';
import { decryptSecret, encryptSecret, factorUri, newFactor, verifyMfaStep } from './mfa';

export const SESSION_COOKIE = 'agri_session';
export const CHALLENGE_COOKIE = 'agri_challenge';
export const SESSION_SECONDS = 8 * 60 * 60;
export const CHALLENGE_SECONDS = 5 * 60;
interface User { id: string; role: Role; enabled: boolean; username: string; password_hash: string | null; auth_version: number }
export type AuthResult = { kind: 'session'; token: string; actor: Actor; recoveryCodes?: string[] }
  | { kind: 'mfa'; token: string; enrollment: boolean };

async function rateLimit(client: PoolClient, key: string, at: Date): Promise<AppError | null> {
  const hash = digest(key);
  await client.query('INSERT INTO login_attempts(key_hash,window_start) VALUES($1,$2) ON CONFLICT DO NOTHING', [hash, at]);
  const row = (await client.query('SELECT * FROM login_attempts WHERE key_hash=$1 FOR UPDATE', [hash])).rows[0];
  if (row.blocked_until && row.blocked_until > at) return new AppError(429, 'LOGIN_LIMITED', '尝试次数过多，请15分钟后重试');
  if (at.getTime() - row.window_start.getTime() >= 15 * 60_000) {
    await client.query('UPDATE login_attempts SET failures=0,window_start=$2,blocked_until=NULL WHERE key_hash=$1', [hash, at]);
  }
  return null;
}
async function failed(client: PoolClient, key: string, at: Date) {
  await client.query(`UPDATE login_attempts SET failures=failures+1,
    blocked_until=CASE WHEN failures+1>=5 THEN $2::timestamptz + interval '15 minutes' ELSE NULL END WHERE key_hash=$1`, [digest(key), at]);
}
async function clearFailures(client: PoolClient, key: string, at: Date) {
  await client.query('UPDATE login_attempts SET failures=0,blocked_until=NULL,window_start=$2 WHERE key_hash=$1', [digest(key), at]);
}
export async function issueSession(client: PoolClient, user: User, mfa: boolean, at: Date): Promise<AuthResult & { kind: 'session' }> {
  const token = newToken();
  await client.query('INSERT INTO sessions(token_hash,user_id,auth_version,mfa_verified,expires_at) VALUES($1,$2,$3,$4,$5)', [digest(token), user.id, user.auth_version, mfa, new Date(at.getTime() + SESSION_SECONDS * 1000)]);
  await audit(client, user.id, 'login_succeeded');
  return { kind: 'session', token, actor: { id: user.id, role: user.role, enabled: true, mfaVerified: mfa } };
}
export async function beginAuthentication(client: PoolClient, user: User, at: Date): Promise<AuthResult> {
  if (!user.enabled) throw invalidCredentials();
  if (!await requiresMfa(client, user.id)) return issueSession(client, user, false, at);
  const enrollment = !(await client.query('SELECT 1 FROM second_factors WHERE user_id=$1', [user.id])).rowCount;
  const token = newToken();
  await client.query('INSERT INTO auth_challenges(token_hash,user_id,auth_version,expires_at) VALUES($1,$2,$3,$4)', [digest(token), user.id, user.auth_version, new Date(at.getTime() + CHALLENGE_SECONDS * 1000)]);
  return { kind: 'mfa', token, enrollment };
}
export async function login(username: string, password: string, options: IdentityOptions = {}): Promise<AuthResult> {
  if (typeof username !== 'string' || typeof password !== 'string' || username.length > 80 || password.length > 256) throw invalidCredentials();
  const normalized = username.trim().toLowerCase(), at = now(options), key = 'password:' + normalized;
  const result = await transaction(async client => {
    const limited = await rateLimit(client, key, at);
    if (limited) return limited;
    const user: User | undefined = (await client.query('SELECT * FROM users WHERE username=$1 FOR UPDATE', [normalized])).rows[0];
    const valid = await verifyPassword(password, user?.password_hash ?? dummyHash);
    if (!valid || !user?.enabled) {
      await failed(client, key, at);
      await audit(client, user?.id ?? null, 'login_failed');
      return invalidCredentials();
    }
    await clearFailures(client, key, at);
    return beginAuthentication(client, user, at);
  }, options.pool);
  if (result instanceof AppError) throw result;
  return result;
}
async function challengeUser(client: PoolClient, token: string, at: Date) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw unauthenticated();
  const challenge = (await client.query('SELECT * FROM auth_challenges WHERE token_hash=$1 FOR UPDATE', [digest(token)])).rows[0];
  if (!challenge || challenge.consumed_at || challenge.expires_at <= at) throw unauthenticated();
  const user: User = (await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [challenge.user_id])).rows[0];
  if (!user.enabled || user.auth_version !== challenge.auth_version) throw unauthenticated();
  return { challenge, user };
}
export async function enrollment(token: string, options: IdentityOptions = {}) {
  return transaction(async client => {
    const { challenge, user } = await challengeUser(client, token, now(options));
    if ((await client.query('SELECT 1 FROM second_factors WHERE user_id=$1', [user.id])).rowCount) throw new AppError(409, 'ALREADY_ENROLLED', '已绑定验证器，请输入动态验证码');
    let secret: string;
    if (challenge.encrypted_secret) secret = decryptSecret(challenge.encrypted_secret, user.id, options.encryptionKey);
    else {
      secret = newFactor(user.username).secret;
      await client.query('UPDATE auth_challenges SET encrypted_secret=$2 WHERE token_hash=$1', [digest(token), encryptSecret(secret, user.id, options.encryptionKey)]);
    }
    return { secret, uri: factorUri(secret, user.username) };
  }, options.pool);
}
export async function finishMfa(token: string, code: string, options: IdentityOptions = {}): Promise<AuthResult & { kind: 'session' }> {
  if (typeof code !== 'string' || code.length > 64) throw invalidCredentials();
  const at = now(options);
  const result = await transaction(async client => {
    const { challenge, user } = await challengeUser(client, token, at);
    const key = 'mfa:' + user.id, limited = await rateLimit(client, key, at);
    if (limited) return limited;
    const factor = (await client.query('SELECT * FROM second_factors WHERE user_id=$1 FOR UPDATE', [user.id])).rows[0];
    if (factor && challenge.encrypted_secret) return unauthenticated();
    const encrypted = factor?.encrypted_secret ?? challenge.encrypted_secret;
    if (!encrypted) return invalidCredentials();
    const secret = decryptSecret(encrypted, user.id, options.encryptionKey);
    const step = await verifyMfaStep(secret, code, at, factor ? Number(factor.last_time_step) : undefined);
    let recovery = false;
    if (step === null && factor && /^[a-f0-9]{24}$/.test(code)) {
      recovery = !!(await client.query('UPDATE recovery_codes SET used_at=$3 WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL RETURNING code_hash', [user.id, digest(code), at])).rowCount;
    }
    if (step === null && !recovery) {
      await failed(client, key, at);
      await audit(client, user.id, 'mfa_failed');
      return invalidCredentials();
    }
    let recoveryCodes: string[] | undefined;
    if (!factor) {
      await client.query('INSERT INTO second_factors(user_id,encrypted_secret,last_time_step) VALUES($1,$2,$3)', [user.id, encrypted, step]);
      recoveryCodes = Array.from({ length: 8 }, () => randomBytes(12).toString('hex'));
      for (const value of recoveryCodes) await client.query('INSERT INTO recovery_codes(user_id,code_hash) VALUES($1,$2)', [user.id, digest(value)]);
      await client.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
      await audit(client, user.id, 'mfa_enrolled');
    } else if (step !== null) {
      await client.query('UPDATE second_factors SET last_time_step=$2 WHERE user_id=$1', [user.id, step]);
    }
    if (recovery) await audit(client, user.id, 'recovery_code_used');
    await clearFailures(client, key, at);
    await client.query('UPDATE auth_challenges SET consumed_at=$2,encrypted_secret=NULL WHERE token_hash=$1', [digest(token), at]);
    return { ...await issueSession(client, user, true, at), ...(recoveryCodes ? { recoveryCodes } : {}) };
  }, options.pool);
  if (result instanceof AppError) throw result;
  return result;
}
export async function resolveSession(token: string, options: IdentityOptions = {}): Promise<Actor> {
  if (!/^[a-f0-9]{64}$/.test(token)) throw unauthenticated();
  return database(async client => {
    const row = (await client.query(`SELECT u.*,s.mfa_verified FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.expires_at>$2 AND u.enabled AND s.auth_version=u.auth_version`, [digest(token), now(options)])).rows[0];
    if (!row || (!row.mfa_verified && await requiresMfa(client, row.id))) throw unauthenticated();
    return { id: row.id, role: row.role, enabled: true, mfaVerified: row.mfa_verified };
  }, options.pool);
}
export function cookieValue(request: Request, name: string): string {
  return request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1) ?? '';
}
export async function requireActor(request: Request): Promise<Actor> {
  const actor=await resolveSession(cookieValue(request, SESSION_COOKIE)),expected=request.headers.get('X-Expected-Actor-Id');
  if(expected!==null&&expected!==actor.id)throw new AppError(403,'ACCOUNT_CHANGED','当前账号已改变，请保留原草稿核对');
  return actor;
}
export async function logout(token: string, options: IdentityOptions = {}, challengeToken?: string) {
  await transaction(async client => {
    const row = (await client.query('DELETE FROM sessions WHERE token_hash=$1 RETURNING user_id', [digest(token)])).rows[0];
    if (row) await audit(client, row.user_id, 'logout');
    if (challengeToken) await client.query('UPDATE auth_challenges SET consumed_at=clock_timestamp(),encrypted_secret=NULL WHERE token_hash=$1 AND consumed_at IS NULL', [digest(challengeToken)]);
  }, options.pool);
}
