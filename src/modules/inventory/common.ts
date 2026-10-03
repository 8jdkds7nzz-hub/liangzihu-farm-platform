import type {PoolClient} from 'pg';
import type {Action,Actor} from '../../platform/types';
import {AppError} from '../../platform/error';
import {text} from '../../platform/validation';
import {uuid} from '../identity/common';
import {scope,payloadHash,sameHash,lockKey} from '../field/common';
export type Body=Record<string,unknown>;
export async function access(c:PoolClient,a:Actor,objectId:unknown,action:Action='record'){
 uuid(objectId);await scope(c,a,objectId,'read');await scope(c,a,objectId,action);
}
export async function request<T>(c:PoolClient,a:Actor,b:Body,kind:string,objectId:string,work:()=>Promise<T>):Promise<T>{
 if(b.expectedActorId!==undefined&&b.expectedActorId!==a.id)throw new AppError(403,'ACCOUNT_CHANGED','当前账号已改变，请保留原草稿核对');
 const key=text(b.requestKey,'提交标识',120),hash=payloadHash(b);await lockKey(c,a,'inventory:'+kind,key);
 const old=(await c.query('SELECT * FROM inventory_requests WHERE created_by=$1 AND kind=$2 AND request_key=$3',[a.id,kind,key])).rows[0];
 if(old){sameHash(old.input_hash,hash);return old.result;}
 const result=await work();
 await c.query('INSERT INTO inventory_requests(object_id,created_by,kind,request_key,input_hash,result) VALUES($1,$2,$3,$4,$5,$6)',[objectId,a.id,kind,key,hash,JSON.stringify(result)]);
 await c.query('INSERT INTO domain_events(event_type,object_id,payload) VALUES($1,$2,$3)',[(kind.includes('.')?'':'inventory.')+kind,objectId,JSON.stringify({actorId:a.id,resultId:(result as any)?.id??null})]);
 return result;
}
export async function lot(c:PoolClient,a:Actor,id:unknown,action:Action='record',lock=false){
 uuid(id);const r=(await c.query('SELECT * FROM stock_lots WHERE id=$1'+(lock?' FOR UPDATE':''),[id])).rows[0];
 if(!r)throw new AppError(404,'LOT_NOT_FOUND','库存批次不存在');
 await scope(c,a,r.object_id,'read','stock_lot',r.id);await scope(c,a,r.object_id,action,'stock_lot',r.id);return r;
}
export async function location(c:PoolClient,id:unknown,objectId:string){
 uuid(id);const r=(await c.query('SELECT * FROM stock_locations WHERE id=$1',[id])).rows[0];
 if(!r||r.object_id!==objectId)throw new AppError(422,'STOCK_SCOPE','仓位不属于当前批次对象');return r;
}
export async function available(c:PoolClient,row:any){const {assertLotReleased}=await import('../traceability/quality');await assertLotReleased(c,row.id);}

