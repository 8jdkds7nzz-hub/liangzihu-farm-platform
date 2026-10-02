import pg from 'pg';
import {setTimeout as delay} from 'node:timers/promises';
import {readDatabaseConfig} from '../src/platform/config';
import {runOne} from '../src/modules/jobs/runner';
import {runSync} from '../src/modules/connections/weather';
const pool=new pg.Pool(readDatabaseConfig({...process.env,DB_POOL_MAX:process.env.WEATHER_DB_POOL_MAX??'2'}));
let stopped=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopped=true;});
try{do{const worked=await runOne(pool,'weather-'+process.pid,{'weather.sync':job=>runSync(pool,String(job.payload.runId),{lease:job})});if(process.argv.includes('--once'))break;if(!worked)await delay(1000);}while(!stopped);}catch{console.error('天气进程停止，请核对配置；未输出响应或凭据。');process.exitCode=1;}finally{await pool.end();}
