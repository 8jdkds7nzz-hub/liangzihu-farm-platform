import type { PoolClient } from 'pg';
import { database, transaction } from '../db/pool';
import { requireActor } from '../modules/identity/session';
import { assertOrigin, endpoint, json, readJson } from '../modules/identity/http';
import type { Actor } from './types';
export function readApi(request: Request, work: (c: PoolClient, actor: Actor) => Promise<unknown>) {
  return endpoint(async () => { const actor = await requireActor(request); return database(async c => json(await work(c, actor))); });
}
export function writeApi(request: Request, work: (c: PoolClient, actor: Actor, body: Record<string, unknown>) => Promise<unknown>, status = 200) {
  return endpoint(async () => {
    assertOrigin(request); const actor = await requireActor(request), body = await readJson(request);
    return transaction(async c => json(await work(c, actor, body), status));
  });
}
