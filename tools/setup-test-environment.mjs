import {execFileSync} from 'node:child_process';import {randomBytes,randomUUID} from 'node:crypto';
import {existsSync,readFileSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import {dirname,join,resolve} from 'node:path';import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),local=join(root,'.local'),config=join(root,'.env.test.local'),record=join(local,'独立测试环境.json');
let secrets=[];
function docker(args,input){try{return execFileSync('docker',args,{cwd:root,input,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:300000}).trim();}catch{throw Error('TEST_CONTAINER_OPERATION_FAILED');}}
function owned(info){const list=JSON.parse(docker(['inspect',info.name]));if(list[0].Id!==info.containerId||list[0].Config.Labels?.['agri.quality.instance']!==info.id)throw Error('TEST_CONTAINER_OWNER_MISMATCH');return list[0];}
try{
 if(process.argv[2]==='--stop'){
  const info=JSON.parse(readFileSync(record,'utf8'));owned(info);docker(['stop',info.name]);
  if(existsSync(config)&&readFileSync(config,'utf8').includes('TEST_ENVIRONMENT_ID='+info.id+'\n'))rmSync(config);
  rmSync(record);console.log('已停止本副本拥有的独立测试容器；私有验证产物保留。');
 }else{
  if(process.argv.length>2)throw Error('INVALID_ARGUMENT');
  for(const name of ['.env','.env.local','.env.production','.env.production.local'])if(existsSync(join(root,name)))throw Error('ISOLATED_WORKTREE_REQUIRED');
  if(existsSync(config)||existsSync(record))throw Error('TEST_CONFIGURATION_ALREADY_EXISTS');
  mkdirSync(local,{recursive:true,mode:0o700});
  const id=randomUUID(),name='agri-check-'+id.slice(0,12),password=randomBytes(32).toString('hex'),admin=randomBytes(32).toString('hex');secrets=[password,admin];
  const envFile=join(local,'测试容器-'+id+'.env');writeFileSync(envFile,'POSTGRES_PASSWORD='+admin+'\n',{mode:0o600});
  docker(['build','--platform','linux/amd64','-f','ops/Dockerfile.database','-t','agri-quality-db:18-3.6-vector0.8.6','ops']);
  const containerId=docker(['run','-d','--rm','--platform','linux/amd64','--label','agri.quality.instance='+id,'--name',name,'--env-file',envFile,'-p','127.0.0.1::5432','agri-quality-db:18-3.6-vector0.8.6']);
  const info={id,name,containerId,createdAt:new Date().toISOString(),purpose:'synthetic-test-only'};writeFileSync(record,JSON.stringify(info,null,2)+'\n',{mode:0o600});
  let ready=false;for(let i=0;i<60;i++){try{docker(['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres','-d','postgres']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,1000));}}if(!ready)throw Error('TEST_DATABASE_NOT_READY');
  const sql=(s,db='postgres')=>docker(['exec','-i',name,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d',db],s);
  sql("CREATE ROLE agri_tester LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '"+password+"'; CREATE DATABASE agri_test OWNER agri_tester; REVOKE CONNECT ON DATABASE postgres FROM PUBLIC; REVOKE CONNECT ON DATABASE template1 FROM PUBLIC; REVOKE ALL ON DATABASE agri_test FROM PUBLIC; GRANT CONNECT,TEMPORARY ON DATABASE agri_test TO agri_tester;");
  sql("CREATE EXTENSION postgis; CREATE EXTENSION vector SCHEMA public; CREATE TABLE public.check_environment(id uuid PRIMARY KEY,purpose text NOT NULL); INSERT INTO public.check_environment VALUES('"+id+"','synthetic-test-only'); REVOKE ALL ON public.check_environment FROM PUBLIC; GRANT SELECT ON public.check_environment TO agri_tester;",'agri_test');
  const container=owned(info),port=container.NetworkSettings.Ports['5432/tcp'][0].HostPort;
  writeFileSync(config,'TEST_DATABASE_URL=postgresql://agri_tester:'+password+'@127.0.0.1:'+port+'/agri_test\nTEST_DB_CONTAINER='+name+'\nTEST_ENVIRONMENT_ID='+id+'\n',{mode:0o600});
  rmSync(envFile);console.log('独立测试环境已创建，只含agri_test；凭据未输出。');
 }
}catch(e){let message=e.message??'TEST_SETUP_FAILED';for(const secret of secrets)message=message.replaceAll(secret,'[hidden]');console.error(message);process.exitCode=1;}
