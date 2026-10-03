import {existsSync,readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {join} from 'node:path';import {parseEnv} from 'node:util';import pg from 'pg';
import {PROJECT_ROOT} from '../tests/support/artifacts';
export function isolatedFilesReason(root=PROJECT_ROOT):string|null {return ['.env','.env.local','.env.production','.env.production.local'].some(p=>existsSync(join(root,p)))?'ISOLATED_WORKTREE_REQUIRED':null;}
export function testEnvironment(root=PROJECT_ROOT):NodeJS.ProcessEnv {
 const path=join(root,'.env.test.local'),file=existsSync(path)?parseEnv(readFileSync(path,'utf8')):{};
 const env:NodeJS.ProcessEnv={...process.env};for(const key of ['TEST_DATABASE_URL','TEST_DB_CONTAINER','TEST_ENVIRONMENT_ID'])env[key]=process.env[key]??file[key];
 delete env.DATABASE_URL;delete env.AGRI_CHECK_RUN_DIR;
 for(const key of Object.keys(env))if(key.endsWith('_ENABLED'))env[key]='0';
 for(const key of ['MODEL_EXTERNAL_ENABLED','NOTICE_EXTERNAL_ENABLED','WECOM_ENABLED','SMS_ENABLED','VOICE_ENABLED','RENKE_HTTP_ENABLED','CAMERA_READS_ENABLED','MEDIA_REMOTE_READS_ENABLED','QWEATHER_READS_ENABLED','DJI_OPENAPI_READS_ENABLED','EZVIZ_WEBHOOK_ENABLED','CROP_MODEL_EVALUATION_ENABLED'])env[key]='0';
 env.IDENTITY_MFA_REQUIRED='1';return env;
}
export function testUrl(value:string|undefined):URL {
 const u=new URL(value??'');if(!['postgres:','postgresql:'].includes(u.protocol)||u.pathname!=='/agri_test'||u.username!=='agri_tester')throw Error('TEST_DATABASE_IDENTITY_REQUIRED');return u;
}
export function testContainer(env:NodeJS.ProcessEnv, requireOwned=true):string {
 const u=testUrl(env.TEST_DATABASE_URL),name=env.TEST_DB_CONTAINER??'liangzihu-farm-db';
 if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)||!['localhost','127.0.0.1'].includes(u.hostname))throw Error('TEST_CONTAINER_IDENTITY_REQUIRED');
 const info=JSON.parse(execFileSync('docker',['inspect',name],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:5000}))[0];
 if(!info.State.Running||!info.NetworkSettings.Ports['5432/tcp']?.some((p:any)=>p.HostIp==='127.0.0.1'&&p.HostPort===u.port))throw Error('TEST_CONTAINER_PORT_MISMATCH');
 if(requireOwned&&(!env.TEST_ENVIRONMENT_ID||info.Config.Labels?.['agri.quality.instance']!==env.TEST_ENVIRONMENT_ID))throw Error('TEST_INSTANCE_MISMATCH');
 return name;
}
export async function checkTestEnvironment(env:NodeJS.ProcessEnv,root=PROJECT_ROOT):Promise<string|null> {
 const reason=isolatedFilesReason(root);if(reason)return reason;
 try{testUrl(env.TEST_DATABASE_URL);testContainer(env);}catch(e){const message=(e as Error).message;return /^[A-Z_]+$/.test(message)?message:'TEST_CONTAINER_UNAVAILABLE';}
 const c=new pg.Client({connectionString:env.TEST_DATABASE_URL,connectionTimeoutMillis:3000,statement_timeout:3000});
 try{await c.connect();const identity=(await c.query('SELECT current_database() db,current_user AS role,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0];if(identity.db!=='agri_test'||identity.role!=='agri_tester'||identity.rolsuper||identity.rolcreatedb||identity.rolcreaterole)return 'TEST_DATABASE_IDENTITY_REQUIRED';
  const marker=(await c.query('SELECT id,purpose FROM public.check_environment')).rows;
  if(marker.length!==1||marker[0].id!==env.TEST_ENVIRONMENT_ID||marker[0].purpose!=='synthetic-test-only')return 'TEST_INSTANCE_MISMATCH';
  const dev=(await c.query("SELECT has_database_privilege(current_user,oid,'CONNECT') allowed FROM pg_database WHERE datname='agri_dev'")).rows;if(dev.some(r=>r.allowed))return 'DEVELOPMENT_ACCESS_NOT_ALLOWED';return null;
 }catch{return 'TEST_DATABASE_UNAVAILABLE';}finally{await c.end().catch(()=>{});}
}
