import { requireActor } from '@/modules/identity/session';
import { grantAccess, revokeGrant, requireAdmin } from '@/modules/identity/management';
import { assertOrigin, endpoint, json, readJson, textField } from '@/modules/identity/http';
import { database, transaction } from '@/db/pool';
import type { Action } from '@/platform/types';
export async function GET(request: Request) {
  return endpoint(async () => {
    const actor = await requireActor(request);
    return database(async c => { await requireAdmin(c, actor); return json((await c.query('SELECT id,user_id,object_id,action,starts_at,expires_at,revoked_at FROM grants ORDER BY created_at DESC')).rows); });
  });
}
export async function POST(request: Request) {
  return endpoint(async () => {
    assertOrigin(request); const actor = await requireActor(request), body = await readJson(request);
    return transaction(async c => json({ id: await grantAccess(c, actor, { userId: textField(body,'userId'), objectId: textField(body,'objectId'), action: textField(body,'action') as Action, expiresAt: body.expiresAt === undefined ? undefined : textField(body,'expiresAt') }) }, 201));
  });
}
export async function DELETE(request: Request) {
  return endpoint(async () => {
    assertOrigin(request); const actor = await requireActor(request), body = await readJson(request);
    return transaction(async c => { await revokeGrant(c, actor, textField(body,'grantId')); return json({ ok: true }); });
  });
}
