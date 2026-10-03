import pg from 'pg';import {setTimeout as delay} from 'node:timers/promises';import {readDatabaseConfig} from '../src/platform/config';import {runOne} from '../src/modules/jobs/runner';
import {runCrop} from '../src/modules/agronomy/crops';import {runSpectral} from '../src/modules/agronomy/spectral';import {scheduleCrops} from '../src/modules/agronomy/schedules';
import {recoverAgronomy} from '../src/modules/agronomy/common';
const pool=new pg.Pool(readDatabaseConfig({...process.env,DB_POOL_MAX:process.env.AGRONOMY_DB_POOL_MAX??'2'}));let stopped=false,lastSchedule=0;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopped=true;});
try{do{await recoverAgronomy(pool);if(Date.now()-lastSchedule>=30000){await scheduleCrops(pool);lastSchedule=Date.now();}
 const worked=await runOne(pool,'agronomy-'+process.pid,{'agronomy.crop':job=>runCrop(pool,String(job.payload.analysisId),job),'agronomy.spectral':job=>runSpectral(pool,String(job.payload.productId),job)});
 if(process.argv.includes('--once'))break;if(!worked)await delay(1000);
 }while(!stopped);}catch{console.error('农情影像进程停止，请核对私有原件、模型与数据库；未输出原件或凭据。');process.exitCode=1;}finally{await pool.end();}
