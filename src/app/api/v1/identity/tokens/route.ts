import { requireActor } from '@/modules/identity/session';
import { issueIntegrationToken, revokeIntegrationToken } from '@/modules/identity/management';
import { assertOrigin, endpoint, json, readJson, textField } from '@/modules/identity/http';
import { transaction } from '@/db/pool';
export async function POST(request: Request) {
  return endpoint(async () => {
    assertOrigin(request); const actor = await requireActor(request), body = await readJson(request);
    return transaction(async c => json(await issueIntegrationToken(c, actor, { label: textField(body,'label'), objectId: textField(body,'objectId'), action: textField(body,'action') as 'read' | 'record', expiresAt: textField(body,'expiresAt') }), 201));
  });
}
export async function DELETE(request: Request) {
  return endpoint(async () => {
    assertOrigin(request); const actor = await requireActor(request), body = await readJson(request);
    return transaction(async c => { await revokeIntegrationToken(c, actor, textField(body,'id')); return json({ ok: true }); });
  });
}
