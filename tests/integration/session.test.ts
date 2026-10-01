import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { generate } from 'otplib';
import type { Pool } from 'pg';
import { withDb } from '../support/db';
import { hashPassword } from '../../src/modules/identity/password';
import { login, enrollment, finishMfa, resolveSession, logout } from '../../src/modules/identity/session';
import { digest } from '../../src/modules/identity/common';
import { completeWecom, startWecom, type WecomProvider } from '../../src/modules/identity/wecom';
import { objectFixture } from '../support/fixtures';

const password = 'test-only-password-1234';
async function fixture(pool: Pool, role = 'admin') {
  const username = randomUUID();
  const { rows: [user] } = await pool.query('INSERT INTO users(username,display_name,password_hash,role) VALUES($1,$1,$2,$3) RETURNING id', [username, await hashPassword(password), role]);
  let time = new Date();
  const options = { pool, encryptionKey: randomBytes(32).toString('hex'), clock: { now: () => time } };
  const advance = (ms: number) => { time = new Date(time.getTime() + ms); };
  return { username, user, options, advance };
}
async function enrolled(pool: Pool) {
  const f = await fixture(pool);
  const challenge = await login(f.username, password, f.options);
  assert.equal(challenge.kind, 'mfa');
  const factor = await enrollment(challenge.token, f.options);
  const code = await generate({ secret: factor.secret, epoch: Math.floor(f.options.clock.now().getTime() / 1000) });
  const session = await finishMfa(challenge.token, code, f.options);
  return { ...f, factor, code, session, challenge };
}

test('管理员密码只产生短期挑战，验证绑定后才有完整会话；秘密不明文入库', async () => withDb(async pool => {
  const f = await fixture(pool);
  const challenge = await login(f.username, password, f.options);
  assert.equal(challenge.kind, 'mfa');
  assert.equal(Number((await pool.query('SELECT count(*) FROM sessions')).rows[0].count), 0);
  await assert.rejects(() => resolveSession(challenge.token, f.options), { status: 401 });
  const factor = await enrollment(challenge.token, f.options);
  assert.equal((await enrollment(challenge.token, f.options)).secret, factor.secret);
  const code = await generate({ secret: factor.secret, epoch: Math.floor(f.options.clock.now().getTime() / 1000) });
  const session = await finishMfa(challenge.token, code, f.options);
  assert.equal((await resolveSession(session.token, f.options)).mfaVerified, true);
  assert.equal(session.recoveryCodes?.length, 8);
  const stored = JSON.stringify((await pool.query('SELECT * FROM second_factors')).rows);
  assert.equal(stored.includes(factor.secret), false);
  assert.equal(JSON.stringify((await pool.query('SELECT * FROM sessions')).rows).includes(session.token), false);
  assert.equal(JSON.stringify((await pool.query('SELECT * FROM recovery_codes')).rows).includes(session.recoveryCodes![0]), false);
  await assert.rejects(() => finishMfa(challenge.token, code, f.options), { status: 401 });
}));

test('动态验证码不能跨挑战重放；并发恢复码只成功一次且留审计', async () => withDb(async pool => {
  const f = await enrolled(pool);
  const next = await login(f.username, password, f.options);
  await assert.rejects(() => finishMfa(next.token, f.code, f.options), { status: 401 });
  const other = await login(f.username, password, f.options);
  const results = await Promise.allSettled([finishMfa(next.token, f.session.recoveryCodes![0], f.options), finishMfa(other.token, f.session.recoveryCodes![0], f.options)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(Number((await pool.query("SELECT count(*) FROM audit_events WHERE event_type='recovery_code_used'")).rows[0].count), 1);
  const nextCode = await generate({ secret: f.factor.secret, epoch: Math.floor(f.options.clock.now().getTime() / 1000) + 30 });
  f.advance(30_000);
  const last = await login(f.username, password, f.options);
  assert.equal((await finishMfa(last.token, nextCode, f.options)).kind, 'session');
}));

test('新开挑战也不能绕过账号级二次验证失败限制；15分钟后可恢复', async () => withDb(async pool => {
  const f = await enrolled(pool);
  for (let i = 0; i < 5; i++) {
    const challenge = await login(f.username, password, f.options);
    await assert.rejects(() => finishMfa(challenge.token, 'invalid', f.options), { status: 401 });
  }
  const next = await login(f.username, password, f.options);
  await assert.rejects(() => finishMfa(next.token, f.session.recoveryCodes![0], f.options), { status: 429 });
  f.advance(16 * 60_000);
  const later = await login(f.username, password, f.options);
  assert.equal((await finishMfa(later.token, f.session.recoveryCodes![0], f.options)).kind, 'session');
}));

test('密码失败限制持久化，用户名大小写不能绕过；未知账号返回同样错误', async () => withDb(async pool => {
  const f = await fixture(pool, 'worker');
  for (let i = 0; i < 5; i++) await assert.rejects(() => login(f.username.toUpperCase(), 'wrong', f.options), { code: 'INVALID_CREDENTIALS' });
  await assert.rejects(() => login(f.username, password, f.options), { status: 429 });
  await assert.rejects(() => login('unknown-user', 'wrong', f.options), { code: 'INVALID_CREDENTIALS' });
  f.advance(16 * 60_000);
  assert.equal((await login(f.username, password, f.options)).kind, 'session');
}));

test('停用再启用、角色变更、退出和过期均使旧会话失效', async () => withDb(async pool => {
  const f = await fixture(pool, 'worker');
  const first = await login(f.username, password, f.options);
  assert.equal((await resolveSession(first.token, f.options)).role, 'worker');
  await pool.query('UPDATE users SET enabled=false WHERE id=$1', [f.user.id]);
  await assert.rejects(() => resolveSession(first.token, f.options), { status: 401 });
  await pool.query('UPDATE users SET enabled=true WHERE id=$1', [f.user.id]);
  await assert.rejects(() => resolveSession(first.token, f.options), { status: 401 });
  const second = await login(f.username, password, f.options);
  await pool.query("UPDATE users SET role='technician' WHERE id=$1", [f.user.id]);
  await assert.rejects(() => resolveSession(second.token, f.options), { status: 401 });
  const third = await login(f.username, password, f.options);
  await logout(third.token, f.options);
  await assert.rejects(() => resolveSession(third.token, f.options), { status: 401 });
  const fourth = await login(f.username, password, f.options);
  f.advance(9 * 60 * 60_000);
  await assert.rejects(() => resolveSession(fourth.token, f.options), { status: 401 });
}));

test('增加配置权限后，已有普通会话失效并强制二次验证；挑战过期拒绝', async () => withDb(async pool => {
  const f = await fixture(pool, 'technician');
  const session = await login(f.username, password, f.options);
  await pool.query("INSERT INTO grants(user_id,object_id,action,created_by) VALUES($1,$2,'configure',$1)", [f.user.id, await objectFixture(pool,f.user.id)]);
  await assert.rejects(() => resolveSession(session.token, f.options), { status: 401 });
  const challenge = await login(f.username, password, f.options);
  assert.equal(challenge.kind, 'mfa');
  f.advance(301_000);
  await assert.rejects(() => enrollment(challenge.token, f.options), { status: 401 });
}));

test('企业微信替身：state绑定浏览器、一次性消费；只映射已登记启用账号', async () => withDb(async pool => {
  const f = await fixture(pool, 'worker');
  let exchanges = 0;
  const provider: WecomProvider = { corpId: 'fake-corp', authorizationUrl: state => 'https://example.invalid/?state=' + state,
    exchange: async () => { exchanges++; return { corpId: 'fake-corp', userId: 'fake-worker' }; } };
  const attempt = await startWecom(provider, f.options), state = new URL(attempt.url).searchParams.get('state')!;
  await assert.rejects(() => completeWecom(state, '0'.repeat(64), 'test-code', provider, f.options), { status: 401 });
  assert.equal(exchanges, 0);
  await assert.rejects(() => completeWecom(state, attempt.browserToken, 'test-code', provider, f.options), { code: 'WECOM_UNREGISTERED' });
  await pool.query('UPDATE users SET wecom_corp_id=$2,wecom_user_id=$3 WHERE id=$1', [f.user.id, 'fake-corp', 'fake-worker']);
  await assert.rejects(() => completeWecom(state, attempt.browserToken, 'test-code', provider, f.options), { status: 401 });
  const next = await startWecom(provider, f.options), nextState = new URL(next.url).searchParams.get('state')!;
  const session = await completeWecom(nextState, next.browserToken, 'test-code', provider, f.options);
  assert.equal(session.kind, 'session');
  assert.equal((await resolveSession(session.token, f.options)).role, 'worker');
  assert.equal((await pool.query('SELECT consumed_at FROM oauth_states WHERE state_hash=$1', [digest(nextState)])).rows[0].consumed_at instanceof Date, true);
  await pool.query('UPDATE users SET enabled=false WHERE id=$1', [f.user.id]);
  const disabled = await startWecom(provider, f.options);
  await assert.rejects(() => completeWecom(new URL(disabled.url).searchParams.get('state')!, disabled.browserToken, 'test-code', provider, f.options), { code: 'WECOM_UNREGISTERED' });
}));
