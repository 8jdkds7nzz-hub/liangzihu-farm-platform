import type { PoolClient } from 'pg';
import type { Actor } from '../../platform/types';
import { AppError } from '../../platform/error';
import { choice,text,time,integer,finite } from '../../platform/validation';
import { uuid,audit } from '../identity/common';
import { arrayIds,existingObject,lockKey,payloadHash,sameHash,scope,visible } from '../field/common';
export function recordContent(kind:string,value:unknown){
 if(!value||Array.isArray(value)||typeof value!=='object')throw new AppError(400,'RECORD_CONTENT','请填写农事内容');const v=value as Record<string,unknown>;
 const observation=text(v.observation,'工作内容或现场观测',4000),judgment=v.judgment?text(v.judgment,'判断',2000):null,action=v.action?text(v.action,'实际动作',2000):null;
 const amount=v.amount===undefined||v.amount===null||v.amount===''?null:finite(v.amount,'用量');if(amount!==null&&amount<0)throw new AppError(400,'INVALID_AMOUNT','用量不能为负数');const unit=amount===null?null:text(v.unit,'用量单位',40);
 if(['feeding','fertilization','harvest'].includes(kind)&&!v.material)throw new AppError(400,'MATERIAL_REQUIRED','请填写物料或产品名称；未知用量可留空');
 let position=null;if(v.position){const p=v.position as Record<string,unknown>;if(p.consent!==true)throw new AppError(400,'POSITION_CONSENT','位置采集需本人明确同意');const lat=finite(p.lat,'纬度'),lng=finite(p.lng,'经度'),accuracy=finite(p.accuracy,'定位精度');if(Math.abs(lat)>90||Math.abs(lng)>180||accuracy<0)throw new AppError(400,'INVALID_POSITION','定位参数无效');position={lat,lng,accuracy,acquiredAt:time(p.acquiredAt),consent:true};}
 return {observation,judgment,action,amount,unit,position,material:v.material?text(v.material,'物料名称',200):null};
}
export async function submitRecord(c:PoolClient,a:Actor,b:Record<string,unknown>){
 if(b.expectedActorId!==undefined&&b.expectedActorId!==a.id)throw new AppError(403,'ACCOUNT_CHANGED','当前登录账号已改变，草稿保留');uuid(b.objectId);await scope(c,a,b.objectId,'record');const obj={id:b.objectId,version:b.objectVersion};integer(b.objectVersion,'对象版本');const key=text(b.submissionId,'提交标识',120),kind=choice(b.kind,['inspection','feeding','fertilization','irrigation','harvest','other'] as const,'农事类型'),occurred=time(b.occurredAt),content=recordContent(kind,b.content),attachments=arrayIds(b.attachmentIds??[]);
 const batchId=b.batchId??null;if(batchId)uuid(batchId);
 const supersedes=b.supersedesId??null;if(supersedes)uuid(supersedes);const reason=supersedes?text(b.correctionReason,'更正理由',2000):null;
 const hash=payloadHash({objectId:obj.id,objectVersion:b.objectVersion,batchId,kind,occurredAt:occurred,content,attachments:[...attachments].sort(),supersedes,reason});await lockKey(c,a,'record',key);
 const prior=(await c.query('SELECT * FROM farm_records WHERE author_id=$1 AND submission_id=$2',[a.id,key])).rows[0];if(prior){sameHash(prior.content_hash,hash);return {...prior,attachmentIds:attachments,syncState:'synced'};}
 const currentObject=await existingObject(c,a,b);
if(batchId){uuid(batchId);const batch=(await c.query('SELECT * FROM production_batches WHERE id=$1 FOR SHARE',[batchId])).rows[0];if(batch?.object_id!==obj.id||!batch.verified||batch.started_at>new Date(occurred)||(batch.ended_at&&batch.ended_at<=new Date(occurred))||(await c.query('SELECT 1 FROM production_batches WHERE supersedes_id=$1',[batchId])).rowCount)throw new AppError(409,'BATCH_CONFLICT','批次已更正、未确认或不适用于发生时间，请保留草稿核对');}
 if(attachments.length){const files=(await c.query('SELECT id,object_id,ingest_state,created_by,submission_key FROM media_assets WHERE id=ANY($1::uuid[]) FOR SHARE',[attachments])).rows;if(files.length!==attachments.length||files.some(f=>f.object_id!==obj.id||f.ingest_state!=='complete'||f.created_by!==a.id||f.submission_key!==key))throw new AppError(409,'ATTACHMENTS_INCOMPLETE','本次必需附件尚未全部保存，记录未确认同步');}
 let version=1;if(supersedes){const old=(await c.query('SELECT * FROM farm_records WHERE id=$1 FOR UPDATE',[supersedes])).rows[0];if(old?.object_id!==obj.id||b.expectedVersion!==old.version||(await c.query('SELECT 1 FROM farm_records WHERE supersedes_id=$1',[supersedes])).rowCount)throw new AppError(409,'VERSION_CONFLICT','原记录已更正或版本不符');version=old.version+1;}
 const row=(await c.query(`INSERT INTO farm_records(object_id,object_version,batch_id,kind,occurred_at,author_id,submission_id,content_hash,content,version,supersedes_id,correction_reason)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[obj.id,currentObject.version,batchId,kind,occurred,a.id,key,hash,content,version,supersedes,reason])).rows[0];for(const id of attachments)await c.query('INSERT INTO record_attachments VALUES($1,$2)',[row.id,id]);await audit(c,a.id,'farm_record_submitted',row.id);return {...row,attachmentIds:attachments,syncState:'synced'};
}
export async function listRecords(c:PoolClient,a:Actor,objectId?:string){
 const {objects,resources}=await visible(c,a,'record');if(objectId){uuid(objectId);if(!objects.includes(objectId))throw new AppError(403,'ACCESS_DENIED','没有此对象权限');}
 const items=(await c.query(`SELECT r.*,EXISTS(SELECT 1 FROM farm_records n WHERE n.supersedes_id=r.id) AS superseded,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'ingestState',m.ingest_state,'backupState',m.backup_state,'previewOf',m.preview_of)) FROM record_attachments x JOIN media_assets m ON m.id=x.asset_id WHERE x.record_id=r.id),'[]') AS attachments,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('note',v.note,'createdAt',v.created_at)) FROM record_reviews v WHERE v.record_id=r.id),'[]') AS reviews
 FROM farm_records r WHERE object_id=ANY($1::uuid[]) AND ($2::uuid IS NULL OR object_id=$2) AND ($3::uuid[] IS NULL OR id=ANY($3))
 AND ($3::uuid[] IS NULL OR EXISTS(SELECT 1 FROM resource_grants g WHERE g.user_id=$4 AND g.resource_id=r.id AND g.resource_type='record' AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() AND (g.from_at IS NULL OR r.occurred_at>=g.from_at) AND(g.to_at IS NULL OR r.occurred_at<g.to_at))) ORDER BY occurred_at DESC,id LIMIT 200`,[objects,objectId??null,resources,a.id])).rows;return {items};
}
export async function reviewRecord(c:PoolClient,a:Actor,b:Record<string,unknown>){uuid(b.id);const r=(await c.query('SELECT * FROM farm_records WHERE id=$1 FOR UPDATE',[b.id])).rows[0];if(!r)throw new AppError(404,'RECORD_NOT_FOUND','记录不存在');await scope(c,a,r.object_id,'review','record',r.id,r.occurred_at.toISOString());await c.query('INSERT INTO record_reviews(record_id,reviewer_id,note) VALUES($1,$2,$3)',[r.id,a.id,text(b.note,'核查意见',2000)]);await c.query("UPDATE farm_records SET status='reviewed' WHERE id=$1",[r.id]);return {id:r.id,status:'reviewed'};}
export async function importRecords(c:PoolClient,a:Actor,b:Record<string,unknown>){
 if(!Array.isArray(b.rows)||b.rows.length>200)throw new AppError(400,'IMPORT_SIZE','每次最多200行');const importId=text(b.importId,'导入批次标识',100),seen=new Set<number>(),results=[];
 for(const value of b.rows){const row=value as Record<string,unknown>,line=integer(row.line,'原行号',1,1000000);if(seen.has(line))throw new AppError(400,'IMPORT_LINE','原行号重复');seen.add(line);await c.query('SAVEPOINT import_record');try{const record=await submitRecord(c,a,{...row,submissionId:importId+':'+line,attachmentIds:[]});await c.query('RELEASE SAVEPOINT import_record');results.push({line,state:'saved',id:record.id});}catch(e){await c.query('ROLLBACK TO SAVEPOINT import_record');await c.query('RELEASE SAVEPOINT import_record');if(!(e instanceof AppError))throw e;results.push({line,state:'failed',code:e.code,message:e.message});}}
 return {results};
}
