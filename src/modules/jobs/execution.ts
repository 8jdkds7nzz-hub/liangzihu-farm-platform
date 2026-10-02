import type {Pool,PoolClient} from 'pg';
import {database,transaction} from '../../db/pool';
import {AppError} from '../../platform/error';
import {claimJob,finishJob,recoverExpired,type JobLease} from './repository';

export async function assertLease(c:PoolClient,lease:JobLease,businessKey?:string){
 const row=(await c.query("SELECT id FROM jobs WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>clock_timestamp() AND($3::text IS NULL OR business_key=$3) FOR UPDATE",[lease.id,lease.leaseToken,businessKey??null])).rows[0];
 if(!row)throw new AppError(409,'LEASE_LOST','任务租约失效，旧执行结果不再接收');
}
export async function externalStarted(c:PoolClient,lease:JobLease){
 await assertLease(c,lease);await c.query('UPDATE jobs SET external_started_at=COALESCE(external_started_at,clock_timestamp()) WHERE id=$1',[lease.id]);
}
export async function reconcileExecutions(pool:Pool){
 await recoverExpired(pool);
 await transaction(async c=>{
  await c.query(`UPDATE assistant_runs r SET state=CASE WHEN j.state='awaiting_receipt' THEN 'result_unknown' WHEN j.state='failed' THEN 'service_unavailable' ELSE 'queued' END,execution_token=NULL,error_code='EXECUTION_INTERRUPTED'
   FROM jobs j WHERE j.business_key='assistant:'||r.id::text AND r.state='running' AND(j.state IN('retry_wait','awaiting_receipt','failed') OR(j.state='running' AND j.external_started_at IS NULL AND r.execution_token IS DISTINCT FROM j.lease_token))`);
  await c.query(`UPDATE model_reservations m SET state=CASE WHEN r.state='result_unknown' THEN 'unknown' ELSE 'cancelled' END FROM assistant_runs r WHERE r.id=m.run_id AND r.error_code='EXECUTION_INTERRUPTED' AND m.state='reserved'`);
  await c.query(`UPDATE image_reviews r SET state=CASE WHEN j.state='failed' THEN 'failed' ELSE 'queued' END,execution_token=NULL,error_code='EXECUTION_INTERRUPTED'
   FROM jobs j WHERE j.business_key='image-review:'||r.id::text AND r.state='running' AND(j.state IN('retry_wait','failed') OR(j.state='running' AND r.execution_token IS DISTINCT FROM j.lease_token))`);
 },pool);
}
export async function withLease<T>(pool:Pool,key:string,provided:JobLease|undefined,work:(lease:JobLease)=>Promise<T>):Promise<T|undefined>{
 if(provided)await transaction(c=>assertLease(c,provided,key),pool);await reconcileExecutions(pool);
 const lease=provided??await claimJob(pool,'direct-'+process.pid,new Date(),{businessKey:key});
 if(!lease){const job=await database(async c=>(await c.query('SELECT state FROM jobs WHERE business_key=$1',[key])).rows[0],pool);if(job?.state==='done')return;
  throw new AppError(409,job?.state==='awaiting_receipt'?'RESULT_UNKNOWN':'LEASE_LOST','任务尚不可执行或结果待核，不自动重复外发');}
 await transaction(c=>assertLease(c,lease,key),pool);
 let renewing=false;
 const timer=setInterval(()=>{if(renewing)return;renewing=true;void pool.query("UPDATE jobs SET lease_until=clock_timestamp()+interval '60 seconds' WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>clock_timestamp()",[lease.id,lease.leaseToken]).catch(()=>{}).finally(()=>{renewing=false;});},20000);timer.unref();
 try{const result=await work(lease);
  const unknown=await database(async c=>{if(lease.kind==='assistant.generate')return !!(await c.query("SELECT 1 FROM assistant_runs WHERE id=$1 AND state='result_unknown'",[lease.payload.runId])).rowCount;if(lease.kind==='camera.read')return !!(await c.query("SELECT 1 FROM camera_reads WHERE id=$1 AND state='unknown'",[lease.payload.readId])).rowCount;if(lease.kind==='briefing.notify')return !!(await c.query("SELECT 1 FROM briefing_reminders WHERE id=$1 AND state='unknown'",[lease.payload.reminderId])).rowCount;return false;},pool);
  if(unknown||!provided)await finishJob(pool,lease.id,lease.leaseToken,{state:unknown?'awaiting_receipt':'done'});return result;}
 catch(e){if(!provided)await finishJob(pool,lease.id,lease.leaseToken,{state:'failed',errorCode:e instanceof AppError?e.code:'HANDLER_FAILED'});throw e;}
 finally{clearInterval(timer);}
}
