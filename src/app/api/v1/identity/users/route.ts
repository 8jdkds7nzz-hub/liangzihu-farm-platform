import { requireActor } from '@/modules/identity/session';
import { createUser, disableUser, requireAdmin } from '@/modules/identity/management';
import { assertOrigin, endpoint, json, readJson, textField } from '@/modules/identity/http';
import { database, transaction } from '@/db/pool';
import type { Role } from '@/platform/types';
export async function GET(request: Request) {
  return endpoint(async () => {
    const actor = await requireActor(request);
    return database(async c => {
      await requireAdmin(c, actor);
      return json((await c.query('SELECT id,username,display_name,role,enabled FROM users ORDER BY created_at')).rows);
    });
  });
}
export async function POST(request: Request) {
  return endpoint(async () => {
    assertOrigin(request); const actor = await requireActor(request), body = await readJson(request);
    return transaction(async c => json({ id: await createUser(c, actor, { username: textField(body,'username'), displayName: textField(body,'displayName'), password: textField(body,'password'), role: textField(body,'role') as Role }) }, 201));
  });
}
export async function DELETE(request: Request) {
  return endpoint(async () => {
    assertOrigin(request); const actor = await requireActor(request), body = await readJson(request);
    return transaction(async c => { await disableUser(c, actor, textField(body,'userId')); return json({ ok: true }); });
  });
}
