import {execFileSync} from 'node:child_process';import {requireTestDatabaseUrl} from './db';import {testContainer,testUrl} from '../../tools/check-environment';
export function postgresTest(tool:'pg_dump'|'pg_restore',args:string[],input?:Buffer):Buffer {
 const url=testUrl(requireTestDatabaseUrl()),name=testContainer(process.env,!!process.env.TEST_ENVIRONMENT_ID);
 try{return execFileSync('docker',['exec','-i','-e','PGPASSWORD',name,tool,'--host','127.0.0.1','--username','agri_tester','--dbname','agri_test',...args],{input,env:{...process.env,PGPASSWORD:decodeURIComponent(url.password)},stdio:['pipe','pipe','pipe'],timeout:60000,maxBuffer:64*1024*1024});}
 catch{throw new Error('TEST_BACKUP_OR_RESTORE_FAILED');}
}
