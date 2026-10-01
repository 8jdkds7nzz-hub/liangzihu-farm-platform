import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withDb } from '../support/db';
import { transaction } from '../../src/db/pool';
import { assertAccess, listAccessibleObjects, assertIntegrationAccess, roleActions } from '../../src/modules/identity/access';
import { grantAccess, revokeGrant, issueIntegrationToken, disableUser } from '../../src/modules/identity/management';
import type { Actor, Action } from '../../src/platform/types';
import type { Pool } from 'pg';
import { objectFixture } from '../support/fixtures';

export async function user(pool: Pool, role: Actor['role'] = 'expert'): Promise<Actor> {
  const id = randomUUID();
  await pool.query('INSERT INTO users(id,username,display_name,role) VALUES($1,$2,$2,$3)', [id, id, role]);
  return { id, role, enabled: true, mfaVerified: true };
}
const scope = (objectId: string, action: Action = 'read') => ({ objectId, action, at: '2000-01-01T00:00:00Z' });

test('同角色仍按对象和动作授权；管理员不自动读取全部业务', async () => withDb(async pool => {
  const admin = await user(pool, 'admin'), a = await user(pool), b = await user(pool);
  const pondA = await objectFixture(pool,admin.id), pondB = randomUUID();
  await transaction(async c => {
    await grantAccess(c, admin, { userId: a.id, objectId: pondA, action: 'read' });
    await assertAccess(c, a, scope(pondA));
    for (const [actor, objectId, action] of [[a, pondB, 'read'], [b, pondA, 'read'], [admin, pondA, 'read'], [a, pondA, 'export']] as const) {
      await assert.rejects(() => assertAccess(c, actor, scope(objectId, action)), { status: 403 });
    }
    assert.deepEqual(await listAccessibleObjects(c, a, 'read'), [pondA]);
    assert.deepEqual(await listAccessibleObjects(c, a, 'export'), []);
    await assert.rejects(() => grantAccess(c, admin, { userId: a.id, objectId: pondA, action: 'dispatch' }), { status: 403 });
    assert.equal(roleActions.expert.includes('dispatch'), false);
  }, pool);
}));

test('到期、撤回、停用立即生效，历史at不能绕过当前授权', async () => withDb(async pool => {
  const admin = await user(pool, 'admin'), actor = await user(pool), objectId = await objectFixture(pool,admin.id);
  await transaction(async c => {
    const id = await grantAccess(c, admin, { userId: actor.id, objectId, action: 'read' });
    await assertAccess(c, actor, scope(objectId));
    await revokeGrant(c, admin, id);
    await assert.rejects(() => assertAccess(c, actor, scope(objectId)), { status: 403 });
    assert.deepEqual(await listAccessibleObjects(c, actor, 'read'), []);
    await c.query("INSERT INTO grants(user_id,object_id,action,starts_at,expires_at,created_by) VALUES($1,$2,'read',now()-interval '2 days',now()-interval '1 day',$3)", [actor.id, objectId, admin.id]);
    await assert.rejects(() => assertAccess(c, actor, scope(objectId)), { status: 403 });
    await grantAccess(c, admin, { userId: actor.id, objectId, action: 'read' });
    await disableUser(c, admin, actor.id);
    await assert.rejects(() => assertAccess(c, actor, scope(objectId)), { status: 403 });
  }, pool);
}));

test('机器凭据只存散列、限定对象动作，撤回及签发人停用后拒绝', async () => withDb(async pool => {
  const admin = await user(pool, 'admin'), pond = await objectFixture(pool,admin.id);
  await transaction(async c => {
    const issued = await issueIntegrationToken(c, admin, { label: '只读接入测试', objectId: pond, action: 'read', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const stored = (await c.query('SELECT token_hash FROM integration_tokens WHERE id=$1', [issued.id])).rows[0].token_hash;
    assert.notEqual(stored, issued.token);
    await assertIntegrationAccess(c, issued.token, scope(pond));
    await assert.rejects(() => assertIntegrationAccess(c, issued.token, scope(randomUUID())), { status: 403 });
    await assert.rejects(() => assertIntegrationAccess(c, issued.token, scope(pond, 'record')), { status: 403 });
    await c.query('UPDATE integration_tokens SET revoked_at=now() WHERE id=$1', [issued.id]);
    await assert.rejects(() => assertIntegrationAccess(c, issued.token, scope(pond)), { status: 403 });
    const second = await issueIntegrationToken(c, admin, { label: '停用测试', objectId: pond, action: 'record', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await c.query('UPDATE users SET enabled=false WHERE id=$1', [admin.id]);
    await assert.rejects(() => assertIntegrationAccess(c, second.token, scope(pond, 'record')), { status: 403 });
  }, pool);
}));
