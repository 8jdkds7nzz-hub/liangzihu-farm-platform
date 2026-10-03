import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {randomUUID} from 'node:crypto';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import pg from 'pg';
import {withDb,requireTestDatabaseUrl} from '../support/db';import {actorFixture,objectFixture,permit} from '../support/fixtures';import {syntheticAsset} from '../support/agronomy';import {transaction} from '../../src/db/pool';import {enqueue,recoverExpired,finishJob} from '../../src/modules/jobs/repository';import {runOne} from '../../src/modules/jobs/runner';import {localStore,checksum,type PrivateStore} from '../../src/modules/media/storage';import {backupMedia} from '../../src/modules/media/uploads';
test('Q11真实终止测试worker后恢复租约，四并发消费100任务不重复',{timeout:30000},()=>withDb(async pool=>{
 const schema=(await pool.query('SELECT current_schema() s')).rows[0].s,key='crash-'+randomUUID();
 await pool.query('CREATE TABLE fault_effects(job_id uuid PRIMARY KEY)');
 for(let i=0;i<100;i++)await transaction(c=>enqueue(c,{kind:'fault-probe',businessKey:i===0?key:'fault-'+i,payload:{i},dueAt:new Date().toISOString()}),pool);
 const env:NodeJS.ProcessEnv={...process.env,TEST_CRASH_SCHEMA:schema,TEST_CRASH_KEY:key};delete env.NODE_TEST_CONTEXT;
 const child=spawn(process.execPath,['--import','tsx','tests/support/crash-worker.ts'],{env,stdio:['ignore','pipe','pipe']}),closed=once(child,'exit');child.stderr.resume();
 try{const old:any=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('WORKER_START_TIMEOUT')),10000);child.stdout.on('data',b=>{text+=b;if(text.includes('\n')){clearTimeout(timer);try{resolve(JSON.parse(text.split('\n')[0]));}catch(e){reject(e);}}});child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(Error('WORKER_EXITED_EARLY'));});});assert(old);child.kill('SIGKILL');await closed;
  await new Promise(r=>setTimeout(r,1100));await recoverExpired(pool);assert.equal(await finishJob(pool,old.id,old.leaseToken,{state:'done'}),false);
  const consume=async()=>{while(await runOne(pool,'restarted-'+randomUUID(),{'fault-probe':async job=>{await pool.query('INSERT INTO fault_effects VALUES($1) ON CONFLICT DO NOTHING',[job.id]);}})){};};
  await Promise.all(Array.from({length:4},consume));assert.equal((await pool.query('SELECT count(*) n FROM fault_effects')).rows[0].n,'100');assert.equal((await pool.query("SELECT count(*) n FROM jobs WHERE state='done'")).rows[0].n,'100');assert.equal((await pool.query('SELECT max(attempts) n FROM jobs')).rows[0].n,2);
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed.catch(()=>{});}
}));
test('Q11仅中断自建连接，事务回滚后可重新读写',()=>withDb(async pool=>{
 const schema=(await pool.query('SELECT current_schema() s')).rows[0].s,client=new pg.Client({connectionString:requireTestDatabaseUrl(),options:'-c search_path='+schema+',public'});client.on('error',()=>{});await client.connect();
 try{await pool.query('CREATE TABLE connection_probe(id integer PRIMARY KEY)');await client.query('BEGIN');await client.query('INSERT INTO connection_probe VALUES(1)');const pid=(await client.query('SELECT pg_backend_pid() pid')).rows[0].pid;assert.equal((await pool.query('SELECT pg_terminate_backend($1) stopped',[pid])).rows[0].stopped,true);await assert.rejects(()=>client.query('COMMIT'));assert.equal((await pool.query('SELECT count(*) n FROM connection_probe')).rows[0].n,'0');await pool.query('INSERT INTO connection_probe VALUES(2)');assert.equal((await pool.query('SELECT id FROM connection_probe')).rows[0].id,2);}finally{await client.end().catch(()=>{});}
}));
test('Q11备份写入失败不伪装已备份，重试后原件与副本一致',{timeout:15000},()=>withDb(async pool=>{
 const dir=await mkdtemp(join(tmpdir(),'backup-fault-'));try{const store=localStore(join(dir,'original'),join(dir,'backup')),actor=await actorFixture(pool,'technician'),objectId=await objectFixture(pool,actor.id);await permit(pool,actor.id,objectId,['read','record']);const asset=await syntheticAsset(pool,actor,objectId,store,'rgb');
  const bad:PrivateStore={...store,async putStream(){throw Error('controlled backup failure');}};
  assert.equal(await runOne(pool,'backup-failing',{'media.backup':async lease=>{await backupMedia(pool,asset.id,lease,bad);}}),true);
  assert.notEqual((await pool.query('SELECT backup_state FROM media_assets WHERE id=$1',[asset.id])).rows[0].backup_state,'verified');assert.equal((await pool.query("SELECT state FROM jobs WHERE business_key=$1",['media-backup:'+asset.id])).rows[0].state,'retry_wait');
  await new Promise(r=>setTimeout(r,2100));assert.equal(await runOne(pool,'backup-retry',{'media.backup':async lease=>{await backupMedia(pool,asset.id,lease,store);}}),true);
  const row=(await pool.query('SELECT * FROM media_assets WHERE id=$1',[asset.id])).rows[0];assert.equal(row.backup_state,'verified');assert.equal(checksum(await store.get(row.storage_key,true)),checksum(asset.bytes));assert.equal(checksum(await store.get(row.storage_key)),checksum(asset.bytes));
 }finally{await rm(dir,{recursive:true,force:true});}
}));
