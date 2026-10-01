import { randomUUID } from 'node:crypto';
import type { Pool,PoolClient } from 'pg';
import type { Actor,Role } from '../../src/platform/types';
export async function actorFixture(c:Pool|PoolClient,role:Role='admin'):Promise<Actor> {
  const id=randomUUID();await c.query('INSERT INTO users(id,username,display_name,role) VALUES($1::uuid,$1::text,$1::text,$2)',[id,role]);
  return {id,role,enabled:true,mfaVerified:true};
}
export async function objectFixture(c:Pool|PoolClient,actorId:string,id=randomUUID()):Promise<string> {
  await c.query("INSERT INTO objects(id,code,name,kind,source,created_by) VALUES($1::uuid,$1::text,'合成测试对象','farm','仅测试，不是现场台账',$2)",[id,actorId]);
  return id;
}
export async function permit(c:Pool|PoolClient,userId:string,objectId:string,actions:readonly string[]) {
  for(const action of actions)await c.query('INSERT INTO grants(user_id,object_id,action,created_by) VALUES($1,$2,$3,$1)',[userId,objectId,action]);
}
