import type {Pool,PoolClient} from 'pg';import type {Actor} from '../../platform/types';import {AppError} from '../../platform/error';import {text,time,choice} from '../../platform/validation';import {uuid} from '../identity/common';
import {scope} from '../field/common';import {request,type Body} from '../inventory/common';import {database,transaction} from '../../db/pool';import {enqueue,type JobLease} from '../jobs/repository';import {withLease,assertLease} from '../jobs/execution';import {configuredStore,type PrivateStore,checksum} from '../media/storage';
import {imageAsset,analysisActor,flightScope} from './common';import {localAnalysis} from './process';
export const CROP_VERSION='rgb-exg-v1;siglip2-ba1f3b0843f24bc5417d38e19c37b287d719b2f4:q8:tokens64:crop-taxonomy-v1';
export async function queueCrop(c:PoolClient,a:Actor,b:Body){
 const m=await imageAsset(c,a,b.assetId);if(!['image/png','image/jpeg','image/webp'].includes(m.mime))throw new AppError(415,'CROP_RGB_REQUIRED','照片分析仅接收RGB照片格式；多光谱TIFF请使用指数入口');return request(c,a,b,'agronomy.crop',m.object_id,async()=>{
 if(b.evaluationMode===true&&process.env.CROP_MODEL_EVALUATION_ENABLED!=='1')throw new AppError(409,'CROP_EVALUATION_DISABLED','通用候选模型仍在实验阶段，部署实验开关未启用；可先计算图像特征');
 await flightScope(c,m.object_id,b.flightId);const user=(await c.query('SELECT auth_version FROM users WHERE id=$1',[a.id])).rows[0];
 if((await c.query("SELECT 1 FROM crop_analyses WHERE created_by=$1 AND state IN('queued','running') LIMIT 5",[a.id])).rowCount!>=5)throw new AppError(429,'CROP_PENDING_LIMIT','当前最多5个待分析任务');
 const r=(await c.query('INSERT INTO crop_analyses(object_id,asset_id,flight_id,captured_at,checksum,model_version,evaluation_mode,created_by,auth_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[m.object_id,m.id,b.flightId||null,m.captured_at,m.checksum,CROP_VERSION,b.evaluationMode===true,a.id,user.auth_version])).rows[0];
 await enqueue(c,{kind:'agronomy.crop',businessKey:'agronomy-crop:'+r.id,payload:{analysisId:r.id},dueAt:new Date().toISOString()});return r;
 });
}
export async function runCrop(pool:Pool,id:string,lease?:JobLease,store:PrivateStore=configuredStore()){
 await withLease(pool,'agronomy-crop:'+id,lease,async current=>{
 const r=await transaction(async c=>{await assertLease(c,current);const row=(await c.query("SELECT * FROM crop_analyses WHERE id=$1 AND state IN('queued','running') FOR UPDATE",[id])).rows[0];if(!row)return null;await c.query("UPDATE crop_analyses SET state='running',execution_token=$2 WHERE id=$1",[id,current.leaseToken]);return row;},pool);if(!r)return;
 let result:any=null,error:string|null=null;
 try{const m=await database(async c=>{await assertLease(c,current);const a=await analysisActor(c,r);return imageAsset(c,a,r.asset_id);},pool);const bytes=await store.get(m.storage_key);if(checksum(bytes)!==r.checksum)throw new AppError(503,'MEDIA_INTEGRITY','图片校验失败');if(r.evaluation_mode&&process.env.CROP_MODEL_EVALUATION_ENABLED!=='1')throw new AppError(409,'CROP_EVALUATION_DISABLED','实验开关已关闭');
 result=await localAnalysis('crop',{base64:bytes.toString('base64'),evaluationMode:r.evaluation_mode});
 if(result.agronomicValidation!=='not_validated'||!Number.isFinite(result.greenFraction)||result.greenFraction<0||result.greenFraction>1||r.evaluation_mode&&(!Array.isArray(result.candidates)||result.candidates.length!==5||result.candidates.some((v:any)=>!['canopy','lodging','waterlogging','bare','unknown'].includes(v.label)||!Number.isFinite(v.score)||v.score<0||v.score>1)))throw new AppError(502,'CROP_OUTPUT_INVALID','模型或图像特征输出无效');
 }catch(e){if(e instanceof AppError&&e.code==='LEASE_LOST')throw e;error=e instanceof AppError?e.code:'CROP_FAILED';result=null;}
 await transaction(async c=>{await assertLease(c,current);try{await analysisActor(c,r);}catch{error='ANALYSIS_AUTH_CHANGED';result=null;}
 await c.query('UPDATE crop_analyses SET state=$2,result=$3,error_code=$4,completed_at=now() WHERE id=$1 AND execution_token=$5',[id,error?(error.includes('AUTH')||error.includes('ACCESS')?'blocked':'failed'):'complete',result,error,current.leaseToken]);},pool);
 });
}
export async function labelCrop(c:PoolClient,a:Actor,b:Body){
 uuid(b.analysisId);const r=(await c.query('SELECT * FROM crop_analyses WHERE id=$1',[b.analysisId])).rows[0];if(!r)throw new AppError(404,'CROP_NOT_FOUND','图像分析不存在');await scope(c,a,r.object_id,'review','crop_analysis',r.id);
 return request(c,a,b,'agronomy.crop-label',r.object_id,async()=>(await c.query('INSERT INTO crop_labels(object_id,analysis_id,label,evidence,observed_at,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[r.object_id,r.id,choice(b.label,['canopy','lodging','waterlogging','bare','unknown'] as const,'现场标签'),text(b.evidence,'独立现场依据',4000),time(b.observedAt),a.id])).rows[0]);
}

