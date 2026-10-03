import {execFileSync,spawnSync} from 'node:child_process';import {randomUUID} from 'node:crypto';import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync} from 'node:fs';import {dirname,join,resolve} from 'node:path';import {fileURLToPath} from 'node:url';import {parseEnv} from 'node:util';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const mirror=process.env.AGRI_APT_MIRROR??'official';if(!['official','tuna'].includes(mirror))throw Error('INVALID_APT_MIRROR');
const run=(cmd,args,cwd=root)=>execFileSync(cmd,args,{cwd,stdio:'inherit',timeout:1800000});
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
if(git(['status','--porcelain','--untracked-files=normal']))throw Error('COMMITTED_SOURCE_REQUIRED');
const commit=git(['rev-parse','HEAD']),id=randomUUID(),directory=join(root,'.local/Linux冷安装',id),code=join(directory,'code');mkdirSync(directory,{recursive:true,mode:0o700});
const report={commit,id,startedAt:new Date().toISOString(),finishedAt:null,platform:'linux/amd64',node:'22.15.0',aptMirror:mirror,freshNodeModules:true,sharedDevelopmentCredentials:false,passed:false,exitCode:null,remoteCI:false};
try{
 run('git',['clone','--no-hardlinks','--no-checkout',root,code]);run('git',['checkout','--detach',commit],code);if(existsSync(join(code,'node_modules')))throw Error('FRESH_DEPENDENCIES_REQUIRED');run(process.execPath,['tools/setup-test-environment.mjs'],code);
 const info=JSON.parse(readFileSync(join(code,'.local/独立测试环境.json'),'utf8')),env=parseEnv(readFileSync(join(code,'.env.test.local'),'utf8')),url=new URL(env.TEST_DATABASE_URL);url.hostname='127.0.0.1';url.port='5432';
 const runner='agri-linux-'+id.slice(0,12),envFile=join(directory,'linux.env');writeFileSync(envFile,'TEST_DATABASE_URL='+url+'\nTEST_DB_CONTAINER='+info.name+'\nTEST_ENVIRONMENT_ID='+info.id+'\nTEST_RUNNER_CONTAINER='+runner+'\nCI=true\n',{mode:0o600});
 run('docker',['build','--platform','linux/amd64','--build-arg','DEBIAN_MIRROR='+mirror,'-f','ops/Dockerfile.check-runner','-t','agri-quality-linux:node22','ops']);
 const command='git config --global --add safe.directory /workspace && pnpm install --frozen-lockfile && pnpm exec playwright install --with-deps chromium && pnpm check:core; result=$?; pnpm check:report; exit "$result"';
 const child=spawnSync('docker',['run','--rm','--platform','linux/amd64','--name',runner,'--label','agri.quality.instance='+info.id,'--network','container:'+info.name,'--env-file',envFile,'--mount','type=bind,src='+code+',dst=/workspace','--mount','type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock','agri-quality-linux:node22','sh','-c',command],{stdio:'inherit',timeout:1800000});
 report.exitCode=child.status;const outputs=join(code,'.local/验证记录');const receipts=existsSync(outputs)?readdirSync(outputs).map(name=>join(outputs,name,'公开摘要.json')).filter(p=>existsSync(p)).map(p=>JSON.parse(readFileSync(p,'utf8'))):[];
 report.passed=child.status===0&&receipts.some(r=>r.profile==='core'&&r.passed&&r.sourceCommit===commit);report.publicSummaries=receipts;
}catch(e){report.error=e.code??'LINUX_CHECK_FAILED';}
finally{if(existsSync(join(code,'.local/独立测试环境.json')))try{run(process.execPath,['tools/setup-test-environment.mjs','--stop'],code);}catch{report.cleanupFailed=true;report.passed=false;}
 report.finishedAt=new Date().toISOString();writeFileSync(join(directory,'Linux冷安装实测.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({passed:report.passed,record:join(directory,'Linux冷安装实测.json'),remoteCI:false}));process.exitCode=report.passed?0:1;}
