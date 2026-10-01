import { transaction } from '../../db/pool';
import { AppError } from '../../platform/error';
import { audit, digest, newToken, now, unauthenticated, type IdentityOptions } from './common';
import { beginAuthentication } from './session';

// Server-only exchange boundary. A provider is enabled only after G03's real contract verification.
export interface WecomProvider {
  corpId: string;
  authorizationUrl(state: string): string;
  exchange(code: string): Promise<{ corpId: string; userId: string }>;
}
export function configuredWecomProvider(): WecomProvider {
  throw new AppError(503, 'WECOM_NOT_READY', '企业微信登录尚未完成企业配置与联调，请使用账号登录');
}
export async function startWecom(provider: WecomProvider, options: IdentityOptions = {}) {
  const state = newToken(), browserToken = newToken();
  await transaction(async client => {
    await client.query('INSERT INTO oauth_states(state_hash,browser_hash,expires_at) VALUES($1,$2,$3)', [digest(state), digest(browserToken), new Date(now(options).getTime() + 300_000)]);
  }, options.pool);
  return { browserToken, url: provider.authorizationUrl(state) };
}
export async function completeWecom(state: string, browserToken: string, code: string, provider: WecomProvider, options: IdentityOptions = {}) {
  if (!/^[a-f0-9]{64}$/.test(state) || !/^[a-f0-9]{64}$/.test(browserToken) || !code || code.length > 512) throw unauthenticated();
  // Consume before contacting the provider, including on failure; a retry starts a fresh authorization.
  const valid = await transaction(async client => (await client.query(`UPDATE oauth_states SET consumed_at=$4
    WHERE state_hash=$1 AND browser_hash=$2 AND expires_at>$3 AND consumed_at IS NULL RETURNING state_hash`, [digest(state), digest(browserToken), now(options), now(options)])).rowCount, options.pool);
  if (!valid) throw unauthenticated();
  let identity: { corpId: string; userId: string };
  try { identity = await provider.exchange(code); }
  catch { throw new AppError(502, 'WECOM_EXCHANGE_FAILED', '企业微信身份验证暂时失败，请重新登录'); }
  if (identity.corpId !== provider.corpId || !identity.userId) throw unauthenticated();
  return transaction(async client => {
    const user = (await client.query('SELECT * FROM users WHERE wecom_corp_id=$1 AND wecom_user_id=$2 AND enabled FOR UPDATE', [identity.corpId, identity.userId])).rows[0];
    if (!user) throw new AppError(403, 'WECOM_UNREGISTERED', '该企业微信身份尚未开通平台账号');
    await audit(client, user.id, 'wecom_identity_verified');
    return beginAuthentication(client, user, now(options));
  }, options.pool);
}
