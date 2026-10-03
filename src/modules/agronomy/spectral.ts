import type {Pool,PoolClient} from 'pg';import type {Actor} from '../../platform/types';import {createHash} from 'node:crypto';import {AppError} from '../../platform/error';
import {text,time} from '../../platform/validation';import {scope,arrayIds,lockKey} from '../field/common';import {request,type Body} from '../inventory/common';import {database,transaction} from '../../db/pool';import {enqueue,type JobLease} from '../jobs/repository';import {withLease,assertLease} from '../jobs/execution';
import {configuredStore,type PrivateStore,checksum} from '../media/storage';import {prepareMedia,uploadMedia} from '../media/service';import {imageAsset,analysisActor,flightScope} from './common';import {spectralConfig} from './spectral-math';import {localAnalysis} from './process';
export async function queueSpectral(c:PoolClient,a:Actor,b:Body){
 const m=await imageAsset(c,a,b.assetId,64*1024*1024);if(m.mime!=='image/tiff')throw new AppError(415,'SPECTRAL_TIFF','加工产品须为多波段GeoTIFF');
 return request(c,a,b,'agronomy.spectral',m.object_id,async()=>{
 await lockKey(c,a,'agronomy-quota','spectral');
 if(Number((await c.query("SELECT count(*) FROM spectral_products WHERE created_by=$1 AND state IN('queued','running')",[a.id])).rows[0].count)>=5)throw new AppError(429,'SPECTRAL_PENDING_LIMIT','当前最多5个待计算的多光谱产品');
 const config=spectralConfig(b),raw=arrayIds(b.rawAssetIds??[],100);await flightScope(c,m.object_id,b.flightId);
 for(const id of raw){const original=(await c.query('SELECT * FROM media_assets WHERE id=$1',[id])).rows[0];if(original?.object_id!==m.object_id||original.ingest_state!=='complete'||original.preview_of||original.id===m.id)throw new AppError(422,'SPECTRAL_RAW_SCOPE','原航片须在同对象完整保存');await scope(c,a,m.object_id,'read','media',id);}
 await c.query('SELECT id FROM media_assets WHERE id=$1 FOR UPDATE',[m.id]);const version=Number((await c.query('SELECT COALESCE(max(version),0)+1 AS v FROM spectral_products WHERE asset_id=$1 AND index_kind=$2',[m.id,config.kind])).rows[0].v),user=(await c.query('SELECT auth_version FROM users WHERE id=$1',[a.id])).rows[0];
 const r=(await c.query('INSERT INTO spectral_products(object_id,asset_id,raw_asset_ids,flight_id,captured_at,source_ref,processor,calibration,bands,breaks,index_kind,checksum,version,algorithm_version,created_by,auth_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *',[m.object_id,m.id,raw,b.flightId||null,time(b.capturedAt),text(b.sourceRef,'来源链及原件缺项说明',4000),text(b.processor,'拼接/校正工具和版本',4000),config.calibration,b.bands,JSON.stringify(config.breaks),config.kind,m.checksum,version,'reflectance-index-v1',a.id,user.auth_version])).rows[0];
 await enqueue(c,{kind:'agronomy.spectral',businessKey:'agronomy-spectral:'+r.id,payload:{productId:r.id},dueAt:new Date().toISOString()});return r;
 });
}
export async function runSpectral(pool:Pool,id:string,lease?:JobLease,store:PrivateStore=configuredStore()){
 await withLease(pool,'agronomy-spectral:'+id,lease,async current=>{
 const r=await transaction(async c=>{await assertLease(c,current);const row=(await c.query("SELECT * FROM spectral_products WHERE id=$1 AND state IN('queued','running') FOR UPDATE",[id])).rows[0];if(!row)return null;await c.query("UPDATE spectral_products SET state='running',execution_token=$2 WHERE id=$1",[id,current.leaseToken]);return row;},pool);if(!r)return;
 let output:any=null,error:string|null=null;
 try{const m=await database(async c=>{await assertLease(c,current);const a=await analysisActor(c,r);return imageAsset(c,a,r.asset_id,64*1024*1024);},pool),bytes=await store.get(m.storage_key);
 if(checksum(bytes)!==r.checksum)throw new AppError(503,'MEDIA_INTEGRITY','多光谱原件校验失败');
 output=await localAnalysis('spectral',{base64:bytes.toString('base64'),indexKind:r.index_kind,bands:r.bands,calibration:r.calibration,breaks:r.breaks});
 if(!output.result||output.result.algorithm!=='reflectance-index-v1'||!Number.isFinite(output.result.mean)||typeof output.previewBase64!=='string'||typeof output.indexBase64!=='string')throw new AppError(502,'SPECTRAL_OUTPUT','指数输出格式无效');
 }catch(e){if(e instanceof AppError&&e.code==='LEASE_LOST')throw e;error=e instanceof AppError?e.code:'SPECTRAL_FAILED';output=null;}
 await transaction(async c=>{await assertLease(c,current);let a:Actor|undefined;try{a=await analysisActor(c,r);}catch{error='ANALYSIS_AUTH_CHANGED';output=null;}
 let preview:string|null=null,index:string|null=null;
 if(output&&a){for(const kind of ['preview','index']){const bytes=Buffer.from(kind==='preview'?output.previewBase64:output.indexBase64,'base64'),hex=createHash('sha256').update(r.id+':'+kind).digest('hex'),assetId=[hex.slice(0,8),hex.slice(8,12),'8'+hex.slice(13,16),'8'+hex.slice(17,20),hex.slice(20,32)].join('-');await prepareMedia(c,a,{objectId:r.object_id,assetId,requestKey:'spectral:'+r.id+':'+kind,submissionId:r.id,checksum:checksum(bytes),byteLength:bytes.length,name:kind==='preview'?'指数分类预览.png':'植被指数.tif',mime:kind==='preview'?'image/png':'image/tiff',source:'指数计算 '+r.algorithm_version+'；输入SHA '+r.checksum,previewOf:r.asset_id,capturedAt:r.captured_at.toISOString()});await uploadMedia(c,a,assetId,bytes,store);if(kind==='preview')preview=assetId;else index=assetId;}}
 await assertLease(c,current);await c.query('UPDATE spectral_products SET state=$2,result=$3,error_code=$4,preview_asset_id=$5,index_asset_id=$6,completed_at=now() WHERE id=$1 AND execution_token=$7',[id,error?(error.includes('AUTH')||error.includes('ACCESS')?'blocked':'failed'):'complete',output?.result??null,error,preview,index,current.leaseToken]);
 },pool);
 });
}
