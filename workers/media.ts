import pg from 'pg';
import {setTimeout as delay} from 'node:timers/promises';
import {readDatabaseConfig} from '../src/platform/config';
import {transaction} from '../src/db/pool';
import {runOne} from '../src/modules/jobs/runner';
import {assembleUpload,backupMedia} from '../src/modules/media/uploads';
import {AppError} from '../src/platform/error';
import {runRaster} from '../src/modules/flights/spatial';
import {runRemoteImport} from '../src/modules/media/remote-import';
const pool=new pg.Pool(readDatabaseConfig({...process.env,DB_POOL_MAX:process.env.MEDIA_DB_POOL_MAX??'2'}));let stopped=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopped=true;});
async function cycle(){return runOne(pool,'media-'+process.pid,{'flight.raster':job=>runRaster(pool,String(job.payload.rasterId),job),'media.import':job=>runRemoteImport(pool,String(job.payload.importId),{lease:job}),'media.assemble':job=>assembleUpload(pool,String(job.payload.sessionId),job),'media.backup':async job=>{try{await backupMedia(pool,String(job.payload.assetId),job);}catch(e){await pool.query("UPDATE media_assets SET backup_state='failed',backup_error=$2 WHERE id=$1",[job.payload.assetId,e instanceof AppError?e.code:'BACKUP_FAILED']);throw e;}}});}
try{do{const worked=await cycle();if(process.argv.includes('--once'))break;if(!worked)await delay(1000);}while(!stopped);}catch{console.error('媒体进程停止，请核对数据库和私有存储。');process.exitCode=1;}finally{await pool.end();}
