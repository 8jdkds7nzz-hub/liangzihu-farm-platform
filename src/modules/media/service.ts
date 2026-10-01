import type { PoolClient } from 'pg';
import type { Actor } from '../../platform/types';
import { AppError } from '../../platform/error';
import { text,integer,time,choice } from '../../platform/validation';
import { uuid,audit } from '../identity/common';
import { stamp,scope,existingObject,lockKey,payloadHash,sameHash } from '../field/common';
import { enqueue } from '../jobs/repository';
import { checksum,configuredStore,type PrivateStore } from './storage';
export const publicAsset=(r:Record<string,unknown>)=>({id:r.id,objectId:r.object_id,name:r.name,mime:r.mime,checksum:r.checksum,byteLength:r.byte_length,capturedAt:r.captured_at,source:r.source,previewOf:r.preview_of,version:r.version,ingestState:r.ingest_state,backupState:r.backup_state,backupError:r.backup_error,downloadUrl:'/api/v1/media/'+r.id});
export async function prepareMedia(c:PoolClient,a:Actor,b:Record<string,unknown>){
 const object=await existingObject(c,a,b);uuid(b.assetId);
 const key=text(b.requestKey,'文件提交标识',120),submission=text(b.submissionId,'农事或成果标识',120),sum=text(b.checksum,'校验值',64);if(!/^[a-f0-9]{64}$/.test(sum))throw new AppError(400,'INVALID_CHECKSUM','请提供SHA-256校验值');
 const normalized={objectId:object.id,assetId:b.assetId,submission,checksum:sum,byteLength:integer(b.byteLength,'文件大小',1,20*1024*1024),name:text(b.name,'文件名',180),mime:choice(b.mime,['image/jpeg','image/png','image/webp','application/pdf','text/plain','text/csv','image/tiff','video/mp4'] as const,'文件类型'),source:text(b.source,'文件来源',2000),capturedAt:b.capturedAt?time(b.capturedAt):null,previewOf:b.previewOf??null};
 if(normalized.previewOf){uuid(normalized.previewOf);const original=(await c.query('SELECT object_id FROM media_assets WHERE id=$1',[normalized.previewOf])).rows[0];if(original?.object_id!==object.id)throw new AppError(422,'PREVIEW_SCOPE','预览与原件须属于同一对象');}
 await lockKey(c,a,'media',key);const hash=payloadHash(normalized),prior=(await c.query('SELECT * FROM media_assets WHERE created_by=$1 AND request_key=$2',[a.id,key])).rows[0];if(prior){sameHash(prior.content_hash,hash);return publicAsset(prior);}
 const row=(await c.query(`INSERT INTO media_assets(id,object_id,submission_key,request_key,content_hash,checksum,byte_length,name,mime,storage_key,captured_at,source,preview_of,created_by)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(id) DO NOTHING RETURNING *`,[b.assetId,object.id,submission,key,hash,sum,normalized.byteLength,normalized.name,normalized.mime,b.assetId+'/'+sum,normalized.capturedAt,normalized.source,normalized.previewOf,a.id])).rows[0];if(!row)throw new AppError(409,'ASSET_ID_CONFLICT','文件标识已被使用');return publicAsset(row);
}
function matchesMime(bytes:Buffer,mime:string){switch(mime){case'image/jpeg':return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;case'image/png':return bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));case'image/webp':return bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';case'application/pdf':return bytes.toString('ascii',0,5)==='%PDF-';case'image/tiff':return ['49492a00','4d4d002a','49492b00','4d4d002b'].includes(bytes.subarray(0,4).toString('hex'));case'video/mp4':return bytes.toString('ascii',4,8)==='ftyp';default:return !bytes.includes(0);}}
export async function uploadMedia(c:PoolClient,a:Actor,id:string,bytes:Buffer,store:PrivateStore=configuredStore()){
 uuid(id);const r=(await c.query('SELECT * FROM media_assets WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!r)throw new AppError(404,'MEDIA_NOT_FOUND','文件清单不存在');await scope(c,a,r.object_id,'record');if(r.created_by!==a.id)throw new AppError(403,'UPLOAD_OWNER','仅提交账号可上传此文件');
 if(bytes.length!==r.byte_length||checksum(bytes)!==r.checksum)throw new AppError(422,'MEDIA_CHECKSUM','文件大小或校验值不一致，未确认上传');if(!matchesMime(bytes,r.mime))throw new AppError(415,'MEDIA_TYPE','文件内容与声明格式不一致');
 if(r.ingest_state!=='complete'){await store.put(r.storage_key,bytes);if(checksum(await store.get(r.storage_key))!==r.checksum)throw new AppError(503,'MEDIA_INTEGRITY','文件复读校验失败');await scope(c,a,r.object_id,'record');await c.query("UPDATE media_assets SET ingest_state='complete' WHERE id=$1",[id]);await audit(c,a.id,'media_uploaded',id);}
 else if(checksum(await store.get(r.storage_key))!==r.checksum)throw new AppError(503,'MEDIA_INTEGRITY','原件校验失败，不能确认已上传');
 await enqueue(c,{kind:'media.backup',businessKey:'media-backup:'+id,payload:{assetId:id},dueAt:stamp()});return publicAsset({...r,ingest_state:'complete'});
}
export async function readMedia(c:PoolClient,a:Actor,id:string,store:PrivateStore=configuredStore()){
 uuid(id);const r=(await c.query('SELECT * FROM media_assets WHERE id=$1',[id])).rows[0];if(!r)throw new AppError(404,'MEDIA_NOT_FOUND','文件不存在');await scope(c,a,r.object_id,'read','media',id,r.captured_at?.toISOString());if(r.ingest_state!=='complete')throw new AppError(409,'MEDIA_PENDING','文件尚未完整保存');const bytes=await store.get(r.storage_key);if(bytes.length!==r.byte_length||checksum(bytes)!==r.checksum)throw new AppError(503,'MEDIA_INTEGRITY','文件校验失败');await scope(c,a,r.object_id,'read','media',id,r.captured_at?.toISOString());return {asset:publicAsset(r),bytes};
}
export async function backupAsset(c:PoolClient,id:string,store:PrivateStore=configuredStore()){
 uuid(id);const r=(await c.query('SELECT * FROM media_assets WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!r||r.ingest_state!=='complete')throw new AppError(409,'MEDIA_PENDING','文件尚未完整保存');const bytes=await store.get(r.storage_key);if(checksum(bytes)!==r.checksum)throw new AppError(503,'MEDIA_INTEGRITY','原件校验失败');await store.put(r.storage_key,bytes,true);if(checksum(await store.get(r.storage_key,true))!==r.checksum)throw new AppError(503,'BACKUP_INTEGRITY','备份复读校验失败');await c.query("UPDATE media_assets SET backup_state='verified',backup_key=storage_key,backup_error=NULL WHERE id=$1",[id]);return {id,verified:true,storageKind:store.kind,independentDisasterRecovery:store.independentBackup};
}
