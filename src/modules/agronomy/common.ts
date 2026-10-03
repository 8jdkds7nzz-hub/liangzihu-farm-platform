import type {Pool,PoolClient} from 'pg';import type {Actor} from '../../platform/types';import {AppError} from '../../platform/error';import {uuid} from '../identity/common';import {scope} from '../field/common';import {transaction} from '../../db/pool';import {recoverExpired} from '../jobs/repository';
export async function imageAsset(c:PoolClient,a:Actor,id:unknown,maxBytes=20*1024*1024){
 uuid(id);const m=(await c.query('SELECT * FROM media_assets WHERE id=$1',[id])).rows[0];if(!m||m.ingest_state!=='complete'||!m.mime.startsWith('image/'))throw new AppError(422,'AGRONOMY_ASSET','影像须完整保存到私有原件库');
 if(Number(m.byte_length)>maxBytes)throw new AppError(413,'AGRONOMY_ASSET_LIMIT','本次分析原件大小超限');
 await scope(c,a,m.object_id,'record');await scope(c,a,m.object_id,'read','media',m.id);return m;
}
export async function analysisActor(c:PoolClient,r:any):Promise<Actor>{
 const u=(await c.query('SELECT role,enabled,auth_version FROM users WHERE id=$1',[r.created_by])).rows[0];
 if(!u?.enabled||u.auth_version!==r.auth_version)throw new AppError(403,'ANALYSIS_AUTH_CHANGED','分析主体或登录授权已改变');
 const a:Actor={id:r.created_by,role:u.role,enabled:true,mfaVerified:true};await scope(c,a,r.object_id,'record');await scope(c,a,r.object_id,'read','media',r.asset_id);return a;
}
export async function flightScope(c:PoolClient,objectId:string,id:unknown){if(id){uuid(id);if((await c.query('SELECT object_id FROM flights WHERE id=$1',[id])).rows[0]?.object_id!==objectId)throw new AppError(422,'AGRONOMY_FLIGHT_SCOPE','航次不属于影像对象');}}
export async function recoverAgronomy(pool:Pool){
 await recoverExpired(pool);await transaction(async c=>{
  for(const [table,prefix] of [['crop_analyses','agronomy-crop:'],['spectral_products','agronomy-spectral:']]){
   await c.query("UPDATE "+table+" r SET state=CASE WHEN j.state='failed' THEN 'failed' ELSE 'queued' END,execution_token=NULL,error_code=COALESCE(j.error_code,'EXECUTION_INTERRUPTED') FROM jobs j WHERE j.business_key=$1||r.id::text AND r.state='running' AND j.state IN('retry_wait','queued','failed')",[prefix]);
  }
 },pool);
}
