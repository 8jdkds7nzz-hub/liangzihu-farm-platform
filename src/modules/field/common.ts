import type { PoolClient } from 'pg';
import type { Actor,Action } from '../../platform/types';
import { AppError } from '../../platform/error';
import { assertAccess,listAccessibleObjects } from '../identity/access';
import { uuid,digest } from '../identity/common';
import { canonicalJson } from '../../platform/json';
export const stamp=()=>new Date().toISOString();
export async function scope(c:PoolClient,a:Actor,objectId:string,action:Action,type?:string,id?:string,occurredAt?:string){
 await assertAccess(c,a,{objectId,action,at:stamp()});
 if(a.role==='expert'){
  if(!type||!id)throw new AppError(403,'ITEM_SCOPE_REQUIRED','专家只能访问明确授权的事项或资料');
  if(!(await c.query(`SELECT 1 FROM resource_grants WHERE user_id=$1 AND object_id=$2 AND resource_type=$3 AND resource_id=$4
   AND revoked_at IS NULL AND expires_at>clock_timestamp() AND ($5::timestamptz IS NULL OR ((from_at IS NULL OR from_at<=$5) AND (to_at IS NULL OR to_at>$5)))`,[a.id,objectId,type,id,occurredAt??null])).rowCount)throw new AppError(403,'ITEM_SCOPE_DENIED','事项授权已失效或不含此资料');
 }
}
export async function visible(c:PoolClient,a:Actor,type:string){
 const objects=await listAccessibleObjects(c,a,'read');
 const resources=a.role==='expert'?(await c.query('SELECT resource_id FROM resource_grants WHERE user_id=$1 AND object_id=ANY($2::uuid[]) AND resource_type=$3 AND revoked_at IS NULL AND expires_at>clock_timestamp()',[a.id,objects,type])).rows.map(r=>r.resource_id):null;
 return {objects,resources};
}
export async function existingObject(c:PoolClient,a:Actor,b:Record<string,unknown>,action:Action='record'){
 if(b.expectedActorId!==undefined&&b.expectedActorId!==a.id)throw new AppError(403,'ACCOUNT_CHANGED','当前登录账号已改变，原账号草稿保留待处理');uuid(b.objectId);await scope(c,a,b.objectId,action);
 const row=(await c.query('SELECT * FROM objects WHERE id=$1 FOR SHARE',[b.objectId])).rows[0];
 if(!row)throw new AppError(404,'OBJECT_NOT_FOUND','对象不存在');
 if(b.objectVersion!==undefined&&b.objectVersion!==row.version)throw new AppError(409,'VERSION_CONFLICT','对象版本已变更，请保留草稿并重新核对');
 return row;
}
export const payloadHash=(b:unknown)=>digest(canonicalJson(b));
export async function lockKey(c:PoolClient,a:Actor,kind:string,key:string){await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[kind+':'+a.id+':'+key]);}
export function sameHash(actual:string,expected:string){if(actual!==expected)throw new AppError(409,'REQUEST_KEY_CONFLICT','同一提交标识对应不同内容，请保留草稿处理冲突');}
export function arrayIds(v:unknown,max=20):string[]{if(!Array.isArray(v)||v.length>max)throw new AppError(400,'INVALID_IDS','附件或对象数量超出范围');for(const id of v)uuid(id);if(new Set(v).size!==v.length)throw new AppError(400,'DUPLICATE_IDS','标识不能重复');return v;}
