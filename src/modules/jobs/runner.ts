import type { Pool } from 'pg';
import type { Clock } from '../../platform/types';
import { systemClock } from '../../platform/clock';
import { AppError } from '../../platform/error';
import { claimJob,finishJob,recoverExpired,type JobLease } from './repository';
export async function runOne(pool:Pool,workerId:string,handlers:Record<string,(job:JobLease)=>Promise<void>>,clock:Clock=systemClock):Promise<boolean>{
  await recoverExpired(pool,clock.now());const job=await claimJob(pool,workerId,clock.now(),{kinds:Object.keys(handlers)});if(!job)return false;
  try{await handlers[job.kind](job);await finishJob(pool,job.id,job.leaseToken,{state:'done'},clock.now());}
  catch(e){const code=e instanceof AppError?e.code:'HANDLER_FAILED';await finishJob(pool,job.id,job.leaseToken,{state:job.attempts>=5?'failed':'retry_wait',errorCode:code,retryAt:new Date(clock.now().getTime()+Math.min(60_000,1000*2**job.attempts))},clock.now());}
  return true;
}
