import type {Pool,PoolClient} from 'pg';import type {Actor} from '../../platform/types';import {AppError} from '../../platform/error';
import {integer,text,time} from '../../platform/validation';import {uuid} from '../identity/common';import {scope} from '../field/common';import {request,type Body} from '../inventory/common';import {transaction} from '../../db/pool';import {requestCameraRead} from '../cameras/readonly';import {queueCrop} from './crops';
async function scheduleActor(c:PoolClient,s:any):Promise<Actor>{
 const u=(await c.query('SELECT role,enabled,auth_version FROM users WHERE id=$1',[s.created_by])).rows[0];if(!u?.enabled||u.auth_version!==s.auth_version)throw new AppError(403,'CROP_SCHEDULE_AUTH_CHANGED','定时抓图主体已改变');
 const a:Actor={id:s.created_by,role:u.role,enabled:true,mfaVerified:true};await scope(c,a,s.object_id,'read');await scope(c,a,s.object_id,'record');await scope(c,a,s.object_id,'configure');return a;
}
export async function saveCropSchedule(c:PoolClient,a:Actor,b:Body){
 uuid(b.deviceId);const d=(await c.query('SELECT d.*,s.verified AS source_verified,s.contract_ref,s.provider,k.verified AS capability_verified,k.capabilities FROM devices d JOIN data_sources s ON s.id=d.source_id LEFT JOIN camera_capabilities k ON k.device_id=d.id WHERE d.id=$1',[b.deviceId])).rows[0];
 if(!d)throw new AppError(404,'DEVICE_NOT_FOUND','摄像通道不存在');await scope(c,a,d.object_id,'read');await scope(c,a,d.object_id,'record');await scope(c,a,d.object_id,'configure');
 if(!d.verified||!d.source_verified||!d.contract_ref||d.provider!=='ezviz'||!d.capability_verified||d.capabilities?.capture!==true||d.capabilities?.readOnlyConfirmed!==true)throw new AppError(409,'CAMERA_CONTRACT_REQUIRED','定时抓图须先核实只读摄像通道和抓拍能力');
 return request(c,a,b,'agronomy.crop-schedule',d.object_id,async()=>{const user=(await c.query('SELECT auth_version FROM users WHERE id=$1',[a.id])).rows[0];return(await c.query('INSERT INTO crop_schedules(object_id,device_id,interval_minutes,enabled,next_at,evaluation_mode,source_ref,created_by,auth_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[d.object_id,d.id,integer(b.intervalMinutes,'间隔分钟',15,10080),b.enabled===true,time(b.nextAt),b.evaluationMode===true,text(b.sourceRef,'抓图范围和时段依据',2000),a.id,user.auth_version])).rows[0];});
}
export async function toggleCropSchedule(c:PoolClient,a:Actor,b:Body){
 uuid(b.id);const r=(await c.query('SELECT * FROM crop_schedules WHERE id=$1',[b.id])).rows[0];if(!r)throw new AppError(404,'SCHEDULE_NOT_FOUND','计划不存在');await scope(c,a,r.object_id,'configure');await scope(c,a,r.object_id,'read');
 return request(c,a,b,'agronomy.crop-schedule-toggle',r.object_id,async()=>{if(typeof b.enabled!=='boolean')throw new AppError(400,'SCHEDULE_STATE','须明确启用或停用');return(await c.query('UPDATE crop_schedules SET enabled=$2 WHERE id=$1 RETURNING *',[r.id,b.enabled])).rows[0];});
}
export async function scheduleCrops(pool:Pool){
 await transaction(async c=>{
 const due=(await c.query('SELECT * FROM crop_schedules WHERE enabled AND next_at<=clock_timestamp() ORDER BY next_at LIMIT 10 FOR UPDATE SKIP LOCKED')).rows;
 for(const s of due){
 let readId:string|null=null,error:string|null=null;await c.query('SAVEPOINT crop_schedule');
 try{const a=await scheduleActor(c,s);if(process.env.CAMERA_READS_ENABLED!=='1')throw new AppError(409,'CAMERA_READS_DISABLED','真实只读抓图关闭');
 if((await c.query("SELECT 1 FROM crop_capture_runs WHERE schedule_id=$1 AND state='waiting'",[s.id])).rowCount)throw new AppError(409,'CROP_CAPTURE_PENDING','前次抓图尚未完成');
 const result=await requestCameraRead(c,a,{deviceId:s.device_id,operation:'capture',requestKey:'crop:'+s.id+':'+s.next_at.toISOString()});readId=result.id;
 }catch(e){await c.query('ROLLBACK TO SAVEPOINT crop_schedule');error=e instanceof AppError?e.code:'CROP_SCHEDULE_FAILED';}finally{await c.query('RELEASE SAVEPOINT crop_schedule');}
 await c.query('INSERT INTO crop_capture_runs(object_id,schedule_id,window_at,camera_read_id,state,error_code) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[s.object_id,s.id,s.next_at,readId,error?'blocked':'waiting',error]);
 await c.query("UPDATE crop_schedules SET next_at=clock_timestamp()+interval '1 minute'*interval_minutes WHERE id=$1",[s.id]);
 }
 },pool);
 await transaction(async c=>{
 const rows=(await c.query("SELECT r.*,s.created_by,s.auth_version,s.enabled,s.evaluation_mode FROM crop_capture_runs r JOIN crop_schedules s ON s.id=r.schedule_id WHERE r.state='waiting' ORDER BY r.created_at LIMIT 10 FOR UPDATE OF r SKIP LOCKED")).rows;
 for(const r of rows){await c.query('SAVEPOINT crop_capture');
 try{if(!r.enabled)throw new AppError(409,'CROP_SCHEDULE_STOPPED','计划已停用');const a=await scheduleActor(c,r),read=(await c.query('SELECT * FROM camera_reads WHERE id=$1',[r.camera_read_id])).rows[0];
 if(read?.state==='ready'&&read.asset_id){const analysis=await queueCrop(c,a,{assetId:read.asset_id,evaluationMode:r.evaluation_mode,requestKey:'capture:'+r.id});await c.query("UPDATE crop_capture_runs SET state='queued',analysis_id=$2 WHERE id=$1",[r.id,analysis.id]);}
 else if(read&&['unknown','blocked','failed'].includes(read.state))await c.query('UPDATE crop_capture_runs SET state=$2,error_code=$3 WHERE id=$1',[r.id,read.state==='unknown'?'unknown':'failed',read.error_code]);
 }catch(e){await c.query('ROLLBACK TO SAVEPOINT crop_capture');await c.query("UPDATE crop_capture_runs SET state='blocked',error_code=$2 WHERE id=$1",[r.id,e instanceof AppError?e.code:'CROP_CAPTURE_FAILED']);}finally{await c.query('RELEASE SAVEPOINT crop_capture');}
 }
 },pool);
}

