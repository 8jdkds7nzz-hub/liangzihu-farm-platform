import type {Pool,PoolClient} from 'pg';
import {AppError} from '../../platform/error';
import {transaction,database} from '../../db/pool';
import {normalizeRenke} from '../../adapters/renke/adapter';
import type {RenkeContract} from '../../adapters/renke/contract';
import {contractValue,pullRenkePage,validateHttpContract,type RenkeHttpContract} from '../../adapters/renke/http';
import {assertAccess} from '../identity/access';
import {persistBatch} from './ingest';
import {heartbeat} from '../operations/heartbeat';

export interface PullConfiguration{actorId:string;authVersion:number;fields:RenkeContract;http:RenkeHttpContract}
export async function runRenkePull(pool:Pool,config:PullConfiguration,options:{synthetic?:boolean;pull?:typeof pullRenkePage}={}){
  const synthetic=options.synthetic===true;
  if((synthetic||options.pull)&&(await pool.query('SELECT current_database() AS name')).rows[0].name!=='agri_test')throw new AppError(403,'RENKE_TEST_ONLY','合成传输仅允许测试库');
  if(!synthetic&&process.env.RENKE_HTTP_ENABLED!=='1')throw new AppError(503,'RENKE_HTTP_DISABLED','实际仁科HTTP拉取尚未启用');
  validateHttpContract(config.http);if(config.http.reference!==config.fields.reference||config.fields.synthetic!==synthetic)throw new AppError(422,'RENKE_CONTRACT_MISMATCH','传输与字段契约依据或性质不一致');
  const guard=async(c:PoolClient)=>{const source=(await c.query('SELECT * FROM data_sources WHERE id=$1 FOR SHARE',[config.fields.sourceId])).rows[0],u=(await c.query('SELECT role,enabled,auth_version FROM users WHERE id=$1 FOR SHARE',[config.actorId])).rows[0];if(!source?.verified||source.provider!=='renke'||source.contract_ref!==config.fields.reference||!u?.enabled||u.auth_version!==config.authVersion)throw new AppError(409,'RENKE_CONFIGURATION_CHANGED','当前来源、操作主体或契约已改变');const actor={id:config.actorId,role:u.role,enabled:true,mfaVerified:true};await assertAccess(c,actor,{objectId:source.object_id,action:'record',at:new Date().toISOString()});for(const mapping of config.fields.mappings){const objs=(await c.query('SELECT DISTINCT object_id FROM point_bindings WHERE point_id=$1 AND verified',[mapping.pointId])).rows;for(const o of objs)await assertAccess(c,actor,{objectId:o.object_id,action:'record',at:new Date().toISOString()});}};
  const lock=await pool.connect();let locked=false;
  try{
    locked=(await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',['renke-pull:'+config.fields.sourceId])).rows[0].locked;if(!locked)return {state:'busy',pages:0};
    let pages=0;
    for(;pages<100;pages++){
      const cursor=await database(async c=>{await guard(c);return (await c.query('SELECT cursor FROM ingestion_cursors WHERE source_id=$1',[config.fields.sourceId])).rows[0]?.cursor??null;},pool);
      const raw=await(options.pull??pullRenkePage)(config.http,cursor),receivedAt=new Date().toISOString();let payload:unknown;try{payload=JSON.parse(raw.toString('utf8'));}catch{throw new AppError(422,'RENKE_RESPONSE','接口报文不是JSON，游标未推进');}
      const next=contractValue(payload,config.http.nextCursorPath),more=contractValue(payload,config.http.hasMorePath);if(typeof next!=='string'||!next||next.length>2000||next===cursor||typeof more!=='boolean')throw new AppError(422,'RENKE_PAGE','已核分页契约与响应不符，游标未推进');
      const readings=normalizeRenke(payload,config.fields,receivedAt,synthetic?'synthetic':'real');
      await persistBatch(pool,{sourceId:config.fields.sourceId,raw,receivedAt,synthetic,expectedCursor:cursor,nextCursor:next,readings,resolveMappings:true,guard,contract:{version:config.fields.version,reference:config.fields.reference,snapshot:JSON.parse(JSON.stringify(config.fields))}});
      if(!more){pages++;break;}await new Promise(r=>setTimeout(r,config.http.minIntervalMs));
    }
    await transaction(c=>heartbeat(c,'ingest','http-'+process.pid,'ok',new Date(),!synthetic,synthetic?'SYNTHETIC_HTTP':null),pool);return {state:'ok',pages};
  }catch(e){await transaction(async c=>{await c.query("INSERT INTO source_health(source_id,last_attempt_at,state,error_code) VALUES($1,now(),'unavailable',$2) ON CONFLICT(source_id) DO UPDATE SET last_attempt_at=now(),state='unavailable',error_code=excluded.error_code",[config.fields.sourceId,e instanceof AppError?e.code:'RENKE_HTTP_FAILED']);},pool);throw e;}finally{if(locked)await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',['renke-pull:'+config.fields.sourceId]);lock.release();}
}
