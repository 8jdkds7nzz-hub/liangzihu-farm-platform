import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { generate } from 'otplib';
import { withDb, requireTestDatabaseUrl } from '../support/db';
import { hashPassword } from '../../src/modules/identity/password';
import { objectFixture } from '../support/fixtures';

test('生产构建HTTP：完整登录与MFA、管理员边界、撤权、停用、Origin及无秘密响应', { timeout: 60_000 }, async () => withDb(async pool => {
  const password = randomBytes(24).toString('hex');
  await pool.query("INSERT INTO users(username,display_name,password_hash,role) VALUES('http-admin','HTTP验收管理员',$1,'admin')", [await hashPassword(password)]);
  const schema = (await pool.query('SELECT current_schema() AS name')).rows[0].name;
  const databaseUrl = new URL(requireTestDatabaseUrl());
  databaseUrl.searchParams.set('options', '-c search_path=' + schema + ',public');
  const reserve = createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
  const port = (reserve.address() as { port: number }).port;
  await new Promise<void>(resolve => reserve.close(() => resolve()));
  const origin = 'http://127.0.0.1:' + port;
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)], {
    env: { ...process.env, DATABASE_URL: databaseUrl.toString(), APP_ORIGIN: origin, IDENTITY_ENCRYPTION_KEY: randomBytes(32).toString('hex') }, stdio: 'ignore',
  });
  const closed = once(server, 'exit');
  const adminJar = new Map<string, string>();
  function client(jar: Map<string,string>) {
    return async (path: string, method = 'GET', body?: object, extra: Record<string,string> = {}) => {
      const headers: Record<string,string> = { Cookie: [...jar].map(([k,v]) => k+'='+v).join('; '), ...extra };
      if (method !== 'GET') { headers.Origin ??= origin; headers['Content-Type'] = 'application/json'; }
      const response = await fetch(origin + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'manual' });
      for (const cookie of response.headers.getSetCookie()) { const [name,value] = cookie.split(';')[0].split('='); if (value) jar.set(name,value); else jar.delete(name); }
      const text = await response.text();
      return { response, data: response.headers.get('Content-Type')?.includes('application/json') ? JSON.parse(text) : text };
    };
  }
  const admin = client(adminJar), anonymous = client(new Map());
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (server.exitCode !== null) break;
      try { if ((await fetch(origin + '/api/v1/health/live')).ok) { ready = true; break; } } catch {}
      await delay(100);
    }
    assert(ready, '隔离验收服务器未启动');
    assert.equal((await anonymous('/account')).response.status, 307);
    assert.equal((await anonymous('/api/v1/me')).response.status, 401);
    assert.equal((await admin('/api/v1/auth/login','POST',{username:'http-admin',password},{Origin:'https://evil.example'})).response.status, 403);
    assert.equal((await admin('/api/v1/auth/login','POST',{username:'x',password:'a'.repeat(9000)})).response.status, 413);
    const first = await admin('/api/v1/auth/login','POST',{username:'http-admin',password,role:'owner'});
    assert.equal(first.data.next, 'mfa');
    assert.equal(first.data.token, undefined);
    assert.equal(first.response.headers.get('cache-control'), 'no-store');
    assert(first.response.headers.getSetCookie().every(v => v.includes('HttpOnly') && v.includes('SameSite=Lax')));
    assert.equal(adminJar.has('agri_session'), false);
    assert.equal((await admin('/api/v1/identity/users')).response.status, 401);
    const factor = await admin('/api/v1/auth/mfa/enroll','POST');
    assert.equal(factor.response.status, 200);
    const code = await generate({ secret: factor.data.secret });
    const verified = await admin('/api/v1/auth/mfa/verify','POST',{code});
    assert.equal(verified.response.status, 200);
    assert.equal(verified.data.recoveryCodes.length, 8);
    assert.equal(adminJar.has('agri_challenge'), false);
    const me = await admin('/api/v1/me');
    assert.equal(me.data.actor.role, 'admin'); assert.equal(me.data.actor.mfaVerified, true);
    assert(me.data.scopes.every((s: { objectIds: string[] }) => s.objectIds.length === 0));
    assert.equal(JSON.stringify(me.data).includes(password), false);
    assert.equal(JSON.stringify(me.data).includes(factor.data.secret), false);
    assert.equal((await admin('/account')).response.status, 200);
    const worker = await admin('/api/v1/identity/users','POST',{username:'http-worker',displayName:'HTTP验收工人',password,role:'worker'});
    assert.equal(worker.response.status, 201);
    const objectId = await objectFixture(pool,me.data.actor.id);
    const grant = await admin('/api/v1/identity/grants','POST',{userId:worker.data.id,objectId,action:'read'});
    assert.equal(grant.response.status, 201);
    const workerJar = new Map<string,string>(), workerClient = client(workerJar);
    assert.equal((await workerClient('/api/v1/auth/login','POST',{username:'http-worker',password,role:'admin'})).data.next, 'account');
    assert.equal((await workerClient('/api/v1/identity/users')).response.status, 403);
    assert.equal((await workerClient('/api/v1/identity/grants','POST',{userId:worker.data.id,objectId,action:'configure'})).response.status, 403);
    const workerMe = await workerClient('/api/v1/me');
    assert.equal(workerMe.data.actor.role, 'worker');
    assert.deepEqual(workerMe.data.scopes.find((s: { action: string }) => s.action === 'read').objectIds, [objectId]);
    await admin('/api/v1/identity/grants','DELETE',{grantId:grant.data.id});
    assert.deepEqual((await workerClient('/api/v1/me')).data.scopes.find((s: { action: string }) => s.action === 'read').objectIds, []);
    await admin('/api/v1/identity/users','DELETE',{userId:worker.data.id});
    assert.equal((await workerClient('/api/v1/me')).response.status, 401);
    assert.equal((await admin('/api/v1/auth/wecom/start','POST')).response.status, 503);
    const rawCookie = adminJar.get('agri_session');
    assert.equal((await admin('/api/v1/auth/logout','POST')).response.status, 200);
    assert.equal((await anonymous('/api/v1/me','GET',undefined,{Cookie:'agri_session='+rawCookie})).response.status, 401);
    const audit = JSON.stringify((await pool.query('SELECT * FROM audit_events')).rows);
    assert.equal(audit.includes(password), false); assert.equal(audit.includes(code), false); assert.equal(audit.includes(factor.data.secret), false);
  } finally {
    server.kill('SIGTERM');
    const kill = setTimeout(() => server.kill('SIGKILL'), 5000);
    try { await closed; } finally { clearTimeout(kill); }
  }
}));
