import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {randomUUID} from 'node:crypto';import {cpus,totalmem} from 'node:os';
import {withDb} from '../tests/support/db';import {withApp} from '../tests/support/app';import {actorFixture,objectFixture,permit} from '../tests/support/fixtures';import {artifactPath} from '../tests/support/artifacts';
import {transaction} from '../src/db/pool';import {createLocation} from '../src/modules/inventory/catalog';import {postMovement,balance} from '../src/modules/inventory/ledger';import {exportStock} from '../src/modules/inventory/queries';import {enqueue} from '../src/modules/jobs/repository';import {runOne} from '../src/modules/jobs/runner';
import {checkTestEnvironment,testEnvironment} from './check-environment';
import {atomicJson} from './quality-state';
const env=testEnvironment();delete process.env.DATABASE_URL;Object.assign(process.env,env);assert.equal(await checkTestEnvironment(env),null);
const durationMs=600000,intervalMs=10000,thresholds={durationMs,minimumSamples:30,maximumOperationMs:30000,expectedInitialJobs:100};
const report=await withDb(async pool=>{
 const actor=await actorFixture(pool,'technician'),objectId=await objectFixture(pool,actor.id);await permit(pool,actor.id,objectId,['read','record','export']);
 const location=await transaction(c=>createLocation(c,actor,{objectId,code:'SOAK',name:'合成容量仓',requestKey:randomUUID()}),pool);
 const seed=async(from:number,to:number)=>pool.query("INSERT INTO stock_lots(object_id,code,product,kind,unit,basis,identities,source,created_by) SELECT $1,'SOAK-'||n,'合成容量批次-'||n,'input','kg','as_is',jsonb_build_object('inventory','SOAK-'||n),'仅工程容量数据',$2 FROM generate_series($3::integer,$4::integer) n",[objectId,actor.id,from,to]);await seed(1,250);
 const lot=(await pool.query("SELECT id FROM stock_lots WHERE code='SOAK-1'")).rows[0];await pool.query('CREATE TABLE stability_effects(job_id uuid PRIMARY KEY)');
 const addJob=(key:string)=>transaction(c=>enqueue(c,{kind:'stability.probe',businessKey:key,payload:{synthetic:true},dueAt:new Date().toISOString()}),pool);
 for(let i=0;i<100;i++)await addJob('initial-'+i);
 const drain=async()=>{while(await runOne(pool,'stability-worker',{'stability.probe':async job=>{await pool.query('INSERT INTO stability_effects VALUES($1) ON CONFLICT DO NOTHING',[job.id]);}})){};};await Promise.all(Array.from({length:4},drain));
 const samples:any[]=[],checks={initial100JobsOnce:(await pool.query('SELECT count(*) n FROM stability_effects')).rows[0].n==='100',export5000:false,export5001Rejected:false,duplicateSubmissionsOnce:true,queueDrained:true};assert(checks.initial100JobsOnce);
 const started=Date.now();let count=250;
 await withApp(pool,async app=>{
  const cookie='agri_session='+await app.authenticate(actor);
  while(Date.now()-started<durationMs){const tick=Date.now();
   if(count===250&&tick-started>=durationMs/2){await seed(251,5000);const exported=await transaction(c=>exportStock(c,actor,objectId),pool);assert.equal(exported.tables.stock_lots.length,5000);checks.export5000=true;await seed(5001,5001);await assert.rejects(()=>transaction(c=>exportStock(c,actor,objectId),pool),{code:'EXPORT_LIMIT'});checks.export5001Rejected=true;count=5001;}
   const index=samples.length,body={objectId,lotId:lot.id,locationId:location.id,kind:'receipt',quantity:'1',occurredAt:new Date().toISOString(),evidence:'合成持续运行',requestKey:'soak-'+index};
   const records=await Promise.all([transaction(c=>postMovement(c,actor,body),pool),transaction(c=>postMovement(c,actor,body),pool)]);assert.equal(records[0].id,records[1].id);assert.equal(await transaction(c=>balance(c,lot.id,location.id),pool),String(index+1));
   await addJob('tick-'+index);await Promise.all(Array.from({length:4},drain));
   const t=performance.now(),response=await fetch(app.origin+'/api/v1/inventory/overview?objectId='+objectId,{headers:{Cookie:cookie},signal:AbortSignal.timeout(30000)});assert.equal(response.status,200);const data=await response.json();assert.equal(data.lots.length,200);const latencyMs=performance.now()-t;
   const connections=Number((await pool.query('SELECT count(*) n FROM pg_stat_activity WHERE datname=current_database() AND usename=current_user')).rows[0].n),pending=Number((await pool.query("SELECT count(*) n FROM jobs WHERE kind='stability.probe' AND state<>'done'")).rows[0].n);assert.equal(pending,0);
   let rssBytes:number|null=null,cpuPercent:number|null=null;try{const [rss,cpu]=execFileSync('ps',['-o','rss=,pcpu=','-p',String(app.pid)],{encoding:'utf8'}).trim().split(/\s+/).map(Number);if(Number.isFinite(rss)&&Number.isFinite(cpu)){rssBytes=rss*1024;cpuPercent=cpu;}}catch{/* recorded as unavailable */}
   const operationMs=Date.now()-tick;assert(operationMs<=thresholds.maximumOperationMs);samples.push({elapsedMs:Date.now()-started,records:count,latencyMs,operationMs,pending,connections,webRssBytes:rssBytes,webCpuPercent:cpuPercent,driverRssBytes:process.memoryUsage().rss});
   await atomicJson(artifactPath('稳定性/进行中.json'),{thresholds,samples,productionAccepted:false});console.log('稳定性采样 '+samples.length+' / '+Math.floor((Date.now()-started)/1000)+'s');
   await new Promise(r=>setTimeout(r,Math.max(0,Math.min(intervalMs-operationMs,durationMs-(Date.now()-started)))));
  }
 });
 assert(samples.length>=thresholds.minimumSamples);assert(samples.every(s=>s.webRssBytes!==null&&s.webCpuPercent!==null),'WEB_METRICS_UNAVAILABLE');assert(checks.export5000&&checks.export5001Rejected);assert.equal((await pool.query('SELECT count(*) n FROM stock_lots')).rows[0].n,'5001');assert.equal((await pool.query('SELECT count(*) n FROM stock_entries')).rows[0].n,String(samples.length));assert.equal((await pool.query('SELECT count(*) n FROM stability_effects')).rows[0].n,String(100+samples.length));
 const times=samples.map(s=>s.latencyMs).sort((a,b)=>a-b),percentile=(p:number)=>times[Math.ceil(times.length*p)-1];
 return {checkedAt:new Date().toISOString(),durationMs:Date.now()-started,thresholds,checks,samples,summary:{samples:samples.length,p50Ms:percentile(.5),p95Ms:percentile(.95),maxOperationMs:Math.max(...samples.map(s=>s.operationMs)),maxConnections:Math.max(...samples.map(s=>s.connections)),memoryMeasurements:samples.filter(s=>s.webRssBytes!==null).length},hardware:{platform:process.platform,arch:process.arch,node:process.version,logicalCpus:cpus().length,totalMemoryBytes:totalmem()},passed:true,productionAccepted:false,limits:['仅10分钟、250与5001条合成记录；不证明全场或长期稳定性','列表200上限仍按Q09待改善；5000/5001是既有导出边界','ps CPU为进程累计口径，不能当瞬时整机利用率；内存缺失会显式记录']};
});
await atomicJson(artifactPath('稳定性/持续运行实测.json'),report);console.log(JSON.stringify({passed:report.passed,durationMs:report.durationMs,...report.summary}));
