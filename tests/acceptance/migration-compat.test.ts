import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir,rm,symlink,writeFile } from 'node:fs/promises';
import { randomBytes,randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { withDb,requireTestDatabaseUrl } from '../support/db';
import { loadMigrations,runMigrations } from '../../src/db/migrate';
import { hashPassword } from '../../src/modules/identity/password';
import { objectFixture,permit } from '../support/fixtures';

test('从A01迁移保留身份数据；旧A01登录与权限接口可读取新库，撤权仍即时生效',async()=>withDb(async pool=>{
  const migrations=await loadMigrations();await runMigrations(pool,migrations.filter(m=>m.version<=1));
  const id=randomUUID(),password=randomBytes(24).toString('hex');
  await pool.query("INSERT INTO users(id,username,display_name,password_hash,role) VALUES($1,'compat-worker','合成兼容验证人员',$2,'worker')",[id,await hashPassword(password)]);
  const before=(await pool.query('SELECT password_hash,auth_version FROM users WHERE id=$1',[id])).rows[0];
  await runMigrations(pool,migrations);assert.deepEqual((await pool.query('SELECT password_hash,auth_version FROM users WHERE id=$1',[id])).rows[0],before);
  const objectId=await objectFixture(pool,id);await permit(pool,id,objectId,['read']);
  const schema=(await pool.query('SELECT current_schema() AS name')).rows[0].name,url=new URL(requireTestDatabaseUrl());url.searchParams.set('options','-c search_path='+schema+',public');
  const directory=resolve('.local','旧版兼容验证-'+randomUUID());await mkdir(directory,{recursive:true,mode:0o700});
  try{
    const archive=execFileSync('git',['archive','518f506'],{maxBuffer:8*1024*1024});execFileSync('tar',['-xf','-','-C',directory],{input:archive});
    await symlink(resolve('node_modules'),resolve(directory,'node_modules'),'dir');
    await writeFile(resolve(directory,'兼容验证.ts'),`import assert from 'node:assert/strict';
import { POST } from './src/app/api/v1/auth/login/route';
import { GET } from './src/app/api/v1/me/route';
import { getPool,closePool } from './src/db/pool';
try{
 const origin=process.env.APP_ORIGIN!;
 const response=await POST(new Request(origin+'/api/v1/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'compat-worker',password:process.env.COMPAT_PASSWORD})}));
 assert.equal(response.status,200);const result=await response.json();assert.equal(result.next,'account');
 const cookie=response.headers.getSetCookie().find(c=>c.startsWith('agri_session='))!.split(';')[0];
 const request=()=>new Request(origin+'/api/v1/me',{headers:{Cookie:cookie}});
 const profile=await (await GET(request())).json();assert.deepEqual(profile.scopes.find((s:any)=>s.action==='read').objectIds,[process.env.COMPAT_OBJECT]);
 await getPool().query("UPDATE grants SET revoked_at=now() WHERE object_id=$1",[process.env.COMPAT_OBJECT]);
 const after=await (await GET(request())).json();assert.deepEqual(after.scopes.find((s:any)=>s.action==='read').objectIds,[]);
 await getPool().query("UPDATE users SET enabled=false WHERE username='compat-worker'");assert.equal((await GET(request())).status,401);
 process.stdout.write('old_identity_contract_passed');
}finally{await closePool();}
`,{mode:0o600});
    const output=execFileSync(process.execPath,['--import','tsx','兼容验证.ts'],{cwd:directory,env:{...process.env,DATABASE_URL:url.toString(),APP_ORIGIN:'http://127.0.0.1:3198',COMPAT_PASSWORD:password,COMPAT_OBJECT:objectId},encoding:'utf8',timeout:30_000,stdio:['pipe','pipe','pipe']});
    assert.equal(output,'old_identity_contract_passed');
  }finally{await rm(directory,{recursive:true,force:true});}
}, {migrate:false}));
