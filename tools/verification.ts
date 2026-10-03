import {spawn, execFileSync} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {mkdir, readFile, stat} from 'node:fs/promises';
import {join, relative} from 'node:path';
import {createArtifactRun, PROJECT_ROOT} from '../tests/support/artifacts';
import {acquireCheckLock,atomicJson,digest,fileHash,filesUnder,snapshot,sourceSnapshot} from './quality-state';

export interface CheckStep {
  id:string; title:string; command:string; args:string[];
  dependsOn?:string[]; preflight?:()=>Promise<string|null>|string|null;
  format?:'tap'|'unittest'; timeoutMs?:number;
  testFiles?:string[];
}
export interface TestCounts {total:number; passed:number; failed:number; skipped:number; cancelled:number; todo:number}
export interface StepResult {
  id:string; title:string; command:string[]; status:'running'|'passed'|'failed'|'blocked'|'incomplete'|'interrupted';
  startedAt:string; finishedAt:string; durationMs:number; exitCode:number|null;
  reason:string|null; log:string|null; tests:TestCounts|null;
  testFiles:string[]; failedCases:string[];
}
function git(args:string[]) {try{return execFileSync('git',args,{cwd:PROJECT_ROOT,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{return null;}}

export function parseTestCounts(text:string, format?:CheckStep['format']):TestCounts|null {
  if(format==='tap') {
    const count=(name:string)=>Number([...text.matchAll(new RegExp('^# '+name+' (\\d+)\\s*$','gm'))].at(-1)?.[1]??NaN);
    const result={total:count('tests'),passed:count('pass'),failed:count('fail'),skipped:count('skipped'),cancelled:count('cancelled'),todo:count('todo')};
    return Object.values(result).every(Number.isFinite)?result:null;
  }
  if(format==='unittest') {
    const total=Number(text.match(/Ran (\d+) tests? in /)?.[1]);
    if(!Number.isFinite(total))return null;
    const skipped=Number(text.match(/skipped=(\d+)/)?.[1]??0),failed=Number(text.match(/failures=(\d+)/)?.[1]??0)+Number(text.match(/errors=(\d+)/)?.[1]??0);
    return {total,passed:total-skipped-failed,failed,skipped,cancelled:0,todo:0};
  }
  return null;
}

async function execute(step:CheckStep, env:NodeJS.ProcessEnv, logPath:string, signal?:AbortSignal) {
  await mkdir(join(logPath,'..'),{recursive:true,mode:0o700});
  const log=createWriteStream(logPath,{mode:0o600,flags:'wx'});
  let reason:string|null=null;
  const child=spawn(step.command,step.args,{cwd:PROJECT_ROOT,env,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
  const kill=()=>{try{if(child.pid){if(process.platform==='win32')child.kill('SIGTERM');else process.kill(-child.pid,'SIGTERM');}}catch{/* already exited */}};
  const stop=(code:string)=>{reason=code;kill();};
  const abort=()=>stop('INTERRUPTED');
  signal?.addEventListener('abort',abort,{once:true});
  const timeout=setTimeout(()=>stop('TIMEOUT'),step.timeoutMs??20*60*1000);
  let escalation:ReturnType<typeof setTimeout>|undefined;
  const escalate=()=>{escalation=setTimeout(()=>{try{if(child.pid){if(process.platform==='win32')child.kill('SIGKILL');else process.kill(-child.pid,'SIGKILL');}}catch{/* already exited */}},2000);};
  signal?.addEventListener('abort',escalate,{once:true});
  // Escalate timeouts as well, without blocking the parent event loop.
  const hardTimeout=setTimeout(()=>{try{if(child.pid){if(process.platform==='win32')child.kill('SIGKILL');else process.kill(-child.pid,'SIGKILL');}}catch{/* already exited */}},(step.timeoutMs??20*60*1000)+2000);
  child.stdout.on('data',chunk=>log.write(chunk));child.stderr.on('data',chunk=>log.write(chunk));
  const exitCode=await new Promise<number|null>(resolve=>{child.once('error',()=>{reason='PROCESS_START_FAILED';resolve(null);});child.once('close',code=>resolve(code));});
  clearTimeout(timeout);clearTimeout(hardTimeout);if(escalation)clearTimeout(escalation);
  signal?.removeEventListener('abort',abort);signal?.removeEventListener('abort',escalate);
  await new Promise<void>((resolve,reject)=>{log.once('error',reject);log.end(resolve);});
  return {exitCode,reason,text:await readFile(logPath,'utf8')};
}

export async function runVerification(options:{profile:string;steps:CheckStep[];env?:NodeJS.ProcessEnv;signal?:AbortSignal;historyDirs?:string[];sourceDirectories?:string[];lockPath?:string;retryOf?:string;progressMs?:number}) {
  const runDirectory=createArtifactRun(),start=Date.now();
  const env:NodeJS.ProcessEnv={...process.env,...options.env,AGRI_CHECK_RUN_DIR:runDirectory};delete env.NODE_TEST_CONTEXT;
  const historyDirs=options.historyDirs??['docs/acceptance','docs/evaluations'].map(p=>join(PROJECT_ROOT,p));
  const result={schemaVersion:'project-check-v2',profile:options.profile,runDirectory,startedAt:new Date().toISOString(),finishedAt:null as string|null,durationMs:0,
    state:'running' as 'running'|'finished',passed:false,buildId:null as string|null,source:{commit:git(['rev-parse','HEAD']),dirty:!!git(['status','--porcelain','--untracked-files=normal']),sha256:'',afterSha256:'',files:0,unchanged:false},
    environment:{node:process.version,platform:process.platform,arch:process.arch,testInstance:env.TEST_ENVIRONMENT_ID??null,databasePolicy:'agri_test only',productionAcceptance:false},
    steps:[] as StepResult[],history:{files:0,beforeSha256:'',afterSha256:'',unchanged:false,changes:[] as string[]},
    files:[] as {path:string;bytes:number;sha256:string}[],errors:[] as string[],
    rerun:{parent:options.retryOf??null,comparable:false,recoveredSteps:[] as string[]},
    limits:['工程验收不代替现场验收','重跑保留原失败；本轮通过不抹去不稳定线索','私有日志与恢复副本不可直接公开']};
  let writes=Promise.resolve();
  const save=()=>{const copy=structuredClone(result);writes=writes.then(()=>atomicJson(join(runDirectory,'运行记录.json'),copy));return writes;};
  let release:(()=>Promise<void>)|undefined,before:Record<string,string>|undefined;
  await save();
  try {
    release=await acquireCheckLock(options.lockPath??join(PROJECT_ROOT,'.local/检查锁.json'));
    before=await snapshot(historyDirs);const source=await sourceSnapshot(PROJECT_ROOT,options.sourceDirectories);
    result.source.sha256=digest(source);result.source.files=Object.keys(source).length;
    result.history.files=Object.keys(before).length;result.history.beforeSha256=digest(before);await save();
    const ids=new Set<string>();
    for(const step of options.steps){if(!/^[a-z0-9_-]+$/.test(step.id)||ids.has(step.id)||step.dependsOn?.some(id=>!ids.has(id)))throw new Error('INVALID_CHECK_PLAN');ids.add(step.id);}
    for(const step of options.steps) {
      const started=Date.now(),item:StepResult={id:step.id,title:step.title,command:[step.command,...step.args],status:'running',startedAt:new Date().toISOString(),finishedAt:'',durationMs:0,exitCode:null,reason:null,log:null,tests:null,testFiles:step.testFiles??[],failedCases:[]};
      result.steps.push(item);await save();
      if(options.profile!=='runner-test')console.log('开始 '+step.id);
      const timer=setInterval(()=>{item.durationMs=Date.now()-started;result.durationMs=Date.now()-start;void save().catch(()=>{});if(options.profile!=='runner-test')console.log('进行中 '+step.id+' '+Math.floor(item.durationMs/1000)+'s');},options.progressMs??15000);
      try {
        if(options.signal?.aborted){item.status='interrupted';item.reason='INTERRUPTED';}
        else if(step.dependsOn?.some(id=>result.steps.find(s=>s.id===id)?.status!=='passed')){item.status='blocked';item.reason='DEPENDENCY_NOT_PASSED';}
        else {
          try{item.reason=await step.preflight?.()??null;}catch{item.reason='PREFLIGHT_FAILED';}
          if(item.reason)item.status='blocked';
          else if(options.signal?.aborted){item.status='interrupted';item.reason='INTERRUPTED';}
          else {
            item.log='日志/'+step.id+'.log';const run=await execute(step,env,join(runDirectory,item.log),options.signal);
            item.exitCode=run.exitCode;item.reason=run.reason;item.tests=parseTestCounts(run.text,step.format);
            item.failedCases=[...run.text.matchAll(/^not ok \d+ - (.+)$/gm)].map(m=>m[1]);
            item.status=run.reason==='INTERRUPTED'?'interrupted':run.exitCode===0&&!run.reason?'passed':'failed';
            if(item.status==='passed'&&step.format&&(!item.tests||!item.tests.total||item.tests.failed||item.tests.skipped||item.tests.cancelled||item.tests.todo)){item.status='incomplete';item.reason='TESTS_NOT_FULLY_EXECUTED';}
            if(item.status==='passed'&&step.id==='build')result.buildId=(await readFile(join(PROJECT_ROOT,'.next/BUILD_ID'),'utf8')).trim();
          }
        }
      }catch{item.status='failed';item.reason='STEP_EXECUTION_FAILED';}
      finally{clearInterval(timer);item.finishedAt=new Date().toISOString();item.durationMs=Date.now()-started;await save();}
      if(options.profile!=='runner-test')console.log(step.id+': '+item.status+(item.reason?' ('+item.reason+')':''));
    }
    const after=await snapshot(historyDirs);result.history.afterSha256=digest(after);
    result.history.changes=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(p=>before![p]!==after[p]);result.history.unchanged=result.history.changes.length===0;
    result.source.afterSha256=digest(await sourceSnapshot(PROJECT_ROOT,options.sourceDirectories));result.source.unchanged=result.source.sha256===result.source.afterSha256;
    if(!result.source.unchanged)result.errors.push('SOURCE_CHANGED_DURING_CHECK');
    if(options.retryOf){
      if(!/^[a-zA-Z0-9_-]+$/.test(options.retryOf))throw new Error('INVALID_RERUN_REFERENCE');
      const previous=JSON.parse(await readFile(join(PROJECT_ROOT,'.local/验证记录',options.retryOf,'运行记录.json'),'utf8'));
      result.rerun.comparable=previous.source.sha256===result.source.sha256&&previous.profile===result.profile&&JSON.stringify(previous.environment)===JSON.stringify(result.environment);
      if(result.rerun.comparable)result.rerun.recoveredSteps=result.steps.filter(s=>s.status==='passed'&&previous.steps.some((p:StepResult)=>p.id===s.id&&p.status==='failed')).map(s=>s.id);
    }
  }catch(e){const message=(e as Error).message;result.errors.push(/^[A-Z0-9_]+$/.test(message)?message:'CHECK_EXECUTION_FAILED');}
  finally{
    try{for(const file of await filesUnder(runDirectory))if(file!==join(runDirectory,'运行记录.json')&&!file.endsWith('.tmp'))result.files.push({path:relative(runDirectory,file),bytes:(await stat(file)).size,sha256:await fileHash(file)});}catch{result.errors.push('ARTIFACT_VERIFICATION_FAILED');}
    result.finishedAt=new Date().toISOString();result.durationMs=Date.now()-start;result.state='finished';
    result.passed=!options.signal?.aborted&&result.steps.length===options.steps.length&&result.steps.length>0&&result.steps.every(s=>s.status==='passed')&&result.history.unchanged&&result.source.unchanged&&result.errors.length===0;
    try{await save();}finally{if(release)await release();}
  }return result;
}
