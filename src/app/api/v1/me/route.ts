import { requireActor } from '@/modules/identity/session';
import { endpoint, json } from '@/modules/identity/http';
import { listAccessibleObjects, roleActions } from '@/modules/identity/access';
import { database } from '@/db/pool';
export async function GET(request: Request) {
  return endpoint(async () => {
    const actor = await requireActor(request);
    return database(async client => {
      const user = (await client.query('SELECT display_name,username FROM users WHERE id=$1 AND enabled', [actor.id])).rows[0];
      const scopes: { action: string; objectIds: string[] }[] = [];
      for (const action of roleActions[actor.role]) scopes.push({ action, objectIds: await listAccessibleObjects(client, actor, action) });
      return json({ actor, displayName: user.display_name, username: user.username, scopes });
    });
  });
}
