import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { requireTestDatabaseUrl } from '../support/db';

test('真实网页进程在数据库连接不可用时存活检查仍200，就绪检查503且不泄露凭据', {timeout:30_000}, async()=>{
  const unavailable=createServer(socket=>socket.destroy());unavailable.listen(0,'127.0.0.1');await once(unavailable,'listening');
  const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=(reserve.address() as {port:number}).port;await new Promise<void>(r=>reserve.close(()=>r()));
  const database=new URL(requireTestDatabaseUrl());database.port=String((unavailable.address() as {port:number}).port);database.password=randomBytes(24).toString('hex');
  const token=randomBytes(32).toString('hex'),origin='http://127.0.0.1:'+port;
  const processHandle=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env:{...process.env,DATABASE_URL:database.toString(),DB_CONNECTION_TIMEOUT_MS:'500',APP_ORIGIN:origin,HEALTHCHECK_TOKEN:token},stdio:'ignore'}),closed=once(processHandle,'exit');
  try{
    let started=false;for(let i=0;i<100;i++){if(processHandle.exitCode!==null)break;try{if((await fetch(origin+'/api/v1/health/live')).ok){started=true;break;}}catch{}await delay(100);}assert(started);
    assert.equal((await fetch(origin+'/api/v1/health/ready')).status,401);
    const response=await fetch(origin+'/api/v1/health/ready',{headers:{Authorization:'Bearer '+token}}),body=await response.text();
    assert.equal(response.status,503);assert.equal(body.includes(database.password),false);assert.equal(body.includes(token),false);assert.equal((await fetch(origin+'/api/v1/health/live')).status,200);
  }finally{processHandle.kill('SIGTERM');const kill=setTimeout(()=>processHandle.kill('SIGKILL'),5000);try{await closed;}finally{clearTimeout(kill);await new Promise<void>(r=>unavailable.close(()=>r()));}}
});
