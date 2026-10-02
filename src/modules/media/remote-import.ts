import type {Pool,PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {downloadRemoteFile,type DownloadedFile} from './remote-download';
import {stageOriginalFile,saveStagedOriginal,maximumUploadBytes,type StagedOriginal} from './uploads';
import type {Actor} from '../../platform/types';
import {AppError} from '../../platform/error';
import {text,choice} from '../../platform/validation';
import {database,transaction} from '../../db/pool';
import {uuid,audit} from '../identity/common';
import {encryptSecret,decryptSecret} from '../identity/mfa';
import {listAccessibleObjects} from '../identity/access';
import {scope,lockKey,payloadHash,sameHash} from '../field/common';
import {enqueue,type JobLease} from '../jobs/repository';
import {attachCameraImage} from '../cameras/service';
import {linkFlightAsset} from '../flights/service';
import {prepareMedia,uploadMedia} from './service';
import {checksum,configuredStore,type PrivateStore} from './storage';
import {allowedMediaHosts,validateRemoteUrl,downloadRemoteMedia,REMOTE_MEDIA_MAX_BYTES,type DownloadSettings} from './remote-download';
type Kind='camera_event'|'flight_file';
const mimes=['image/jpeg','image/png','image/webp','application/pdf','text/plain','text/csv','image/tiff','video/mp4'] as const;
const publicRun=(r:any)=>({id:r.id,objectId:r.object_id,targetKind:r.target_kind,targetId:r.camera_event_id??r.flight_file_id,host:r.host,name:r.metadata.name,state:r.state,createdAt:r.created_at,attemptedAt:r.attempted_at,completedAt:r.completed_at,errorCode:r.error_code,assetId:r.asset_id,actualChecksum:r.actual_checksum,byteLength:r.byte_length});
async function target(c:PoolClient,kind:Kind,id:string){
 const row=kind==='camera_event'?(await c.query(`SELECT e.object_id,e.source_id,e.asset_id,s.verified,s.contract_ref,s.provider,s.object_id AS source_object,d.verified AS device_verified,d.object_id AS device_object,d.source_id AS device_source FROM camera_events e JOIN data_sources s ON s.id=e.source_id JOIN devices d ON d.id=e.device_id WHERE e.id=$1 FOR UPDATE OF e FOR SHARE OF s,d`,[id])).rows[0]:(await c.query(`SELECT v.object_id,v.source_id,f.asset_id,f.name,f.checksum,s.verified,s.contract_ref,s.provider,s.object_id AS source_object FROM flight_files f JOIN flights v ON v.id=f.flight_id JOIN data_sources s ON s.id=v.source_id WHERE f.id=$1 FOR UPDATE OF f FOR SHARE OF s`,[id])).rows[0];
 if(!row)throw new AppError(404,'MEDIA_IMPORT_TARGET','原告警或航次文件不存在');return row;
}
async function checkTarget(c:PoolClient,a:Actor,t:any,allowComplete=false){await scope(c,a,t.object_id,'read');await scope(c,a,t.object_id,'record');if(!t.verified||!t.contract_ref||t.source_object!==t.object_id||(t.device_verified!==undefined&&(!t.device_verified||t.device_object!==t.object_id||t.device_source!==t.source_id)))throw new AppError(409,'MEDIA_IMPORT_SOURCE','来源、只读契约或设备尚未核实');if(t.asset_id&&!allowComplete)throw new AppError(409,'MEDIA_IMPORT_COMPLETE','原事件或航次文件已有原件，请核对现有资料');}
async function testOnly(c:PoolClient){if((await c.query('SELECT current_database() AS n')).rows[0].n!=='agri_test')throw new AppError(403,'MEDIA_IMPORT_TEST_ONLY','替身或无租约执行仅允许隔离测试库');}
export async function requestRemoteImport(c:PoolClient,a:Actor,b:Record<string,unknown>,env:NodeJS.ProcessEnv=process.env){
 if(env!==process.env)await testOnly(c);const kind=choice(b.targetKind,['camera_event','flight_file'] as const,'原件关联类型');uuid(b.targetId);const t=await target(c,kind,b.targetId);await checkTarget(c,a,t,true);
 if(b.readOnlyConfirmed!==true||b.plaintextConfirmed!==true)throw new AppError(422,'MEDIA_IMPORT_CONFIRM','须确认链接只读使用权限及文件已解密；加密图片不能直接导入');
 const url=validateRemoteUrl(text(b.url,'下载链接',8192),allowedMediaHosts(env)),mime=choice(b.mime,mimes,'原件类型');if(kind==='camera_event'&&!mime.startsWith('image/'))throw new AppError(422,'MEDIA_IMPORT_IMAGE','监控事件只能关联已解密的图片');
 const metadata={name:kind==='flight_file'?t.name:text(b.name,'原件名称',180),mime,expectedChecksum:kind==='flight_file'?t.checksum:null},evidence=text(b.evidence,'只读链接与原件使用依据',3000),key=text(b.requestKey,'下载请求标识',120),hash=payloadHash({kind,targetId:b.targetId,url:url.toString(),metadata,evidence});
 await lockKey(c,a,'remote-media',key);const prior=(await c.query('SELECT * FROM remote_media_imports WHERE requested_by=$1 AND request_key=$2',[a.id,key])).rows[0];if(prior){sameHash(prior.input_hash,hash);return publicRun(prior);}
 if(t.asset_id)throw new AppError(409,'MEDIA_IMPORT_COMPLETE','原事件或航次文件已有原件，请核对现有资料');
 if((await c.query("SELECT 1 FROM remote_media_imports WHERE (camera_event_id=$1 OR flight_file_id=$1) AND state IN ('queued','running')",[b.targetId])).rowCount)throw new AppError(409,'MEDIA_IMPORT_PENDING','此原件已有待执行任务，请先查看结果');
 const id=randomUUID(),assetId=randomUUID(),encrypted=encryptSecret(url.toString(),'media-import:'+id,env.IDENTITY_ENCRYPTION_KEY),u=(await c.query('SELECT auth_version FROM users WHERE id=$1',[a.id])).rows[0];
 const row=(await c.query(`INSERT INTO remote_media_imports(id,object_id,source_id,source_contract_ref,source_provider,target_kind,camera_event_id,flight_file_id,encrypted_url,url_hash,host,metadata,evidence,requested_by,auth_version,request_key,input_hash,reserved_asset_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,[id,t.object_id,t.source_id,t.contract_ref,t.provider,kind,kind==='camera_event'?b.targetId:null,kind==='flight_file'?b.targetId:null,encrypted,payloadHash(url.toString()),url.hostname,metadata,evidence,a.id,u.auth_version,key,hash,assetId])).rows[0];
 await enqueue(c,{kind:'media.import',businessKey:'media-import:'+id,payload:{importId:id},dueAt:new Date().toISOString(),priority:kind==='camera_event'?50:20});await audit(c,a.id,'media_import_requested',id);return publicRun(row);
}
interface Options{lease?:JobLease;env?:NodeJS.ProcessEnv;store?:PrivateStore;downloader?:(url:string,settings:DownloadSettings)=>Promise<Buffer>;fileDownloader?:(url:string,path:string,settings:DownloadSettings)=>Promise<DownloadedFile>}
async function checkLease(c:PoolClient,id:string,o:Options){if(o.lease&&!(await c.query("SELECT 1 FROM jobs WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>clock_timestamp() AND kind='media.import' AND payload->>'importId'=$3 FOR SHARE",[o.lease.id,o.lease.leaseToken,id])).rowCount)throw new AppError(409,'MEDIA_IMPORT_LEASE','原件任务租约已失效');}
async function current(c:PoolClient,r:any,env:NodeJS.ProcessEnv){
 const u=(await c.query('SELECT role,enabled,auth_version FROM users WHERE id=$1 FOR SHARE',[r.requested_by])).rows[0];if(!u?.enabled||u.auth_version!==r.auth_version)throw new AppError(403,'MEDIA_IMPORT_ACTOR','发起人账号或身份已改变');const actor:Actor={id:r.requested_by,role:u.role,enabled:true,mfaVerified:true},t=await target(c,r.target_kind,r.camera_event_id??r.flight_file_id);await checkTarget(c,actor,t);
 if(t.object_id!==r.object_id||t.source_id!==r.source_id||t.contract_ref!==r.source_contract_ref||t.provider!==r.source_provider||((t.checksum??null)!==r.metadata.expectedChecksum))throw new AppError(409,'MEDIA_IMPORT_SOURCE_CHANGED','原件来源契约或清单已变更，旧链接结果不入库');if(env.MEDIA_REMOTE_READS_ENABLED!=='1')throw new AppError(503,'MEDIA_REMOTE_DISABLED','全局远程原件读取关闭');const url=decryptSecret(r.encrypted_url,'media-import:'+r.id,env.IDENTITY_ENCRYPTION_KEY);validateRemoteUrl(url,allowedMediaHosts(env));return {actor,url};
}
export async function runRemoteImport(pool:Pool,id:string,o:Options={}){
 uuid(id);if(o.downloader||o.fileDownloader||o.store||o.env||!o.lease)await database(testOnly,pool);const token=randomUUID(),env=o.env??process.env;
 const run=await transaction(async c=>{await checkLease(c,id,o);const r=(await c.query('SELECT * FROM remote_media_imports WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!r||!['queued','running'].includes(r.state))return null;if(r.state==='running'){await c.query("UPDATE remote_media_imports SET state='unknown',error_code='MEDIA_IMPORT_INTERRUPTED',completed_at=now() WHERE id=$1",[id]);return null;}await c.query("UPDATE remote_media_imports SET state='running',execution_token=$2,started_at=now() WHERE id=$1",[id,token]);return r;},pool);if(!run)return;let folder:string|undefined;
 try{
 const prepared=await transaction(async c=>{await checkLease(c,id,o);const x=await current(c,run,env);await c.query('UPDATE remote_media_imports SET attempted_at=now() WHERE id=$1',[id]);return x;},pool);
 // External network I/O never holds a database transaction or connection.
 let bytes:Buffer|undefined,staged:StagedOriginal|undefined,sum:string,length:number;
 if(o.downloader){bytes=await o.downloader(prepared.url,{allowedHosts:allowedMediaHosts(env)});length=bytes.length;sum=checksum(bytes);if(!length||length>REMOTE_MEDIA_MAX_BYTES)throw new AppError(422,'MEDIA_REMOTE_SIZE','受控字节下载超过测试/小文件界限');}
 else{folder=await mkdtemp(join(tmpdir(),'agri-original-'));const file=await(o.fileDownloader??downloadRemoteFile)(prepared.url,join(folder,'原件'),{allowedHosts:allowedMediaHosts(env),maxBytes:maximumUploadBytes()});length=file.length;sum=file.checksum;if(run.metadata.expectedChecksum&&sum!==run.metadata.expectedChecksum)throw new AppError(422,'MEDIA_REMOTE_CHECKSUM','实下载SHA与原清单不符');await transaction(async c=>{await checkLease(c,id,o);await current(c,run,env);},pool);staged=await stageOriginalFile(file,run.reserved_asset_id,run.metadata.mime,o.store??configuredStore());}
 if(run.metadata.expectedChecksum&&sum!==run.metadata.expectedChecksum)throw new AppError(422,'MEDIA_REMOTE_CHECKSUM','实下载SHA-256与原清单不符');

 await transaction(async c=>{await checkLease(c,id,o);const r=(await c.query('SELECT state,execution_token FROM remote_media_imports WHERE id=$1 FOR UPDATE',[id])).rows[0];if(r.state!=='running'||r.execution_token!==token)throw new AppError(409,'MEDIA_IMPORT_INTERRUPTED','原件请求状态已改变，旧结果不入库');const x=await current(c,run,env);
 if(staged)await saveStagedOriginal(c,x.actor,{objectId:run.object_id,assetId:run.reserved_asset_id,requestKey:'remote-media:'+run.id,submissionId:run.camera_event_id??run.flight_file_id,name:run.metadata.name,mime:run.metadata.mime,source:'授权链接原件导入；来源ID '+run.source_id+'；任务ID '+run.id},staged);
 else{await prepareMedia(c,x.actor,{objectId:run.object_id,assetId:run.reserved_asset_id,requestKey:'remote-media:'+run.id,submissionId:run.camera_event_id??run.flight_file_id,checksum:sum,byteLength:length,name:run.metadata.name,mime:run.metadata.mime,source:'授权链接原件导入；来源ID '+run.source_id+'；任务ID '+run.id});await uploadMedia(c,x.actor,run.reserved_asset_id,bytes!,o.store??configuredStore());}
 await checkLease(c,id,o);await current(c,run,env);
 if(run.target_kind==='camera_event')await attachCameraImage(c,x.actor,{id:run.camera_event_id,assetId:run.reserved_asset_id});else await linkFlightAsset(c,x.actor,{fileId:run.flight_file_id,assetId:run.reserved_asset_id});
 await c.query("UPDATE remote_media_imports SET state='complete',asset_id=$2,actual_checksum=$3,byte_length=$4,error_code=NULL,completed_at=now() WHERE id=$1",[id,run.reserved_asset_id,sum,length]);await audit(c,x.actor.id,'media_import_complete',id);
 },pool);
 }catch(e){const code=e instanceof AppError?e.code:'MEDIA_IMPORT_FAILED',state=['MEDIA_IMPORT_LEASE','MEDIA_IMPORT_INTERRUPTED'].includes(code)?'unknown':e instanceof AppError&&(e.status===403||e.status===409||['MEDIA_REMOTE_DISABLED','MEDIA_REMOTE_HOSTS','IDENTITY_NOT_CONFIGURED'].includes(code))?'blocked':'failed';await transaction(async c=>{const changed=await c.query("UPDATE remote_media_imports SET state=$2,error_code=$3,completed_at=now() WHERE id=$1 AND state='running' AND execution_token=$4 RETURNING id",[id,state,code,token]);if(changed.rowCount&&run.camera_event_id)await c.query("UPDATE camera_events SET image_state='failed',image_error=$2 WHERE id=$1 AND asset_id IS NULL",[run.camera_event_id,code]);},pool);}finally{if(folder)await rm(folder,{recursive:true,force:true});}
}
export async function listRemoteImports(c:PoolClient,a:Actor){if(a.role==='expert')throw new AppError(403,'EXPERT_ITEM_ONLY','专家请从明确分享的事件或原件入口访问');const ids=await listAccessibleObjects(c,a,'read'),rows=(await c.query('SELECT * FROM remote_media_imports WHERE object_id=ANY($1::uuid[]) ORDER BY created_at DESC LIMIT 200',[ids])).rows;return {items:rows.map(publicRun),globalReadsEnabled:process.env.MEDIA_REMOTE_READS_ENABLED==='1',allowedHosts:allowedMediaHosts()};}
