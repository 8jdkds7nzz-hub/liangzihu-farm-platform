import { transaction } from '../../db/pool';
import { AppError } from '../../platform/error';
import { audit, digest, newToken, now, unauthenticated, type IdentityOptions } from './common';
import { beginAuthentication } from './session';
import {configuredWecomClient} from '../../adapters/wecom/client';

// Server-only exchange boundary. A provider is enabled only after G03's real contract verification.
export interface WecomProvider {
  corpId: string;
  authorizationUrl(state: string): string;
  exchange(code: string): Promise<{ corpId: string; userId: string }>;
}
export function configuredWecomProvider(): WecomProvider {
  const client=configuredWecomClient(),corpId=process.env.WECOM_CORP_ID!,origin=new URL(process.env.APP_ORIGIN??'');if(origin.protocol!=='https:'&&!(origin.protocol==='http:'&&origin.hostname==='127.0.0.1'))throw new AppError(503,'WECOM_REDIRECT','回调必须为已核HTTPS平台或本机测试地址');const callback=new URL('/api/v1/auth/wecom/callback',origin).toString();
  return {corpId,authorizationUrl(state){const u=new URL('https://open.weixin.qq.com/connect/oauth2/authorize');u.searchParams.set('appid',corpId);u.searchParams.set('redirect_uri',callback);u.searchParams.set('response_type','code');u.searchParams.set('scope','snsapi_base');u.searchParams.set('agentid',process.env.WECOM_AGENT_ID!);u.searchParams.set('state',state);u.hash='wechat_redirect';return u.toString();},exchange:code=>client.member(code)};
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
