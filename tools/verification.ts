import {createHash} from 'node:crypto';
import {spawn, execFileSync} from 'node:child_process';
import {createReadStream, createWriteStream} from 'node:fs';
import {mkdir, readdir, readFile, stat, writeFile} from 'node:fs/promises';
import {join, relative} from 'node:path';
import {createArtifactRun, PROJECT_ROOT} from '../tests/support/artifacts';

export interface CheckStep {
  id:string; title:string; command:string; args:string[];
  dependsOn?:string[]; preflight?:()=>Promise<string|null>|string|null;
  format?:'tap'|'unittest'; timeoutMs?:number;
}
export interface TestCounts {total:number; passed:number; failed:number; skipped:number; cancelled:number; todo:number}
export interface StepResult {
  id:string; title:string; command:string[]; status:'passed'|'failed'|'blocked'|'incomplete'|'interrupted';
  startedAt:string; finishedAt:string; durationMs:number; exitCode:number|null;
  reason:string|null; log:string|null; tests:TestCounts|null;
}

async function hash(file:string) {
  const hash=createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function filesUnder(directory:string):Promise<string[]> {
  let entries;
  try {entries=await readdir(directory,{withFileTypes:true});}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
  const files:string[]=[];
  for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
    if(entry.isSymbolicLink())throw new Error('检查产物或证据目录不能包含符号链接');
    const path=join(directory,entry.name);
    if(entry.isDirectory())files.push(...await filesUnder(path));
    else if(entry.isFile())files.push(path);
  }
  return files;
}
async function snapshot(directories:string[]) {
  const result:Record<string,string>={};
  for(const directory of directories)for(const file of await filesUnder(directory))result[relative(PROJECT_ROOT,file)]=await hash(file);
  return result;
}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
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

export async function runVerification(options:{profile:string;steps:CheckStep[];env?:NodeJS.ProcessEnv;signal?:AbortSignal;historyDirs?:string[]}) {
  const runDirectory=createArtifactRun(),start=Date.now(),startedAt=new Date().toISOString();
  const historyDirs=options.historyDirs??['docs/acceptance','docs/evaluations'].map(p=>join(PROJECT_ROOT,p));
  const before=await snapshot(historyDirs),source=await snapshot(['src','db','workers','tools','tests','ops'].map(p=>join(PROJECT_ROOT,p)));
  for(const name of ['package.json','pnpm-lock.yaml','next.config.ts','tsconfig.json'])source[name]=await hash(join(PROJECT_ROOT,name));
  const env:NodeJS.ProcessEnv={...process.env,...options.env,AGRI_CHECK_RUN_DIR:runDirectory};
  // An independent nested check must not inherit Node's internal test IPC protocol.
  delete env.NODE_TEST_CONTEXT;
  const result={schemaVersion:'project-check-v1',profile:options.profile,runDirectory,startedAt,finishedAt:null as string|null,durationMs:0,
    state:'running' as 'running'|'finished',passed:false,
    source:{commit:git(['rev-parse','HEAD']),dirty:!!git(['status','--porcelain','--untracked-files=normal']),sha256:digest(source),files:Object.keys(source).length},
    environment:{node:process.version,platform:process.platform,arch:process.arch,database:'agri_test only',productionAcceptance:false},
    steps:[] as StepResult[],history:{files:Object.keys(before).length,beforeSha256:digest(before),afterSha256:null as string|null,unchanged:false,changes:[] as string[]},
    files:[] as {path:string;bytes:number;sha256:string}[],errors:[] as string[],
    limits:['本机工程检查，不是现场或生产验收','单次套件统计不累加历史重跑；评测问题数和恢复动作不当作测试用例数','日志、转储和密钥均为私有产物，不可自动发布']};
  const save=()=>writeFile(join(runDirectory,'运行记录.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
  await save();
  try {
    for(const step of options.steps) {
      if(!/^[a-z0-9_-]+$/.test(step.id)||result.steps.some(s=>s.id===step.id))throw new Error('检查步骤ID无效或重复');
      const t=Date.now(),item:StepResult={id:step.id,title:step.title,command:[step.command,...step.args],status:'blocked',startedAt:new Date().toISOString(),finishedAt:'',durationMs:0,exitCode:null,reason:null,log:null,tests:null};
      result.steps.push(item);
      if(options.signal?.aborted){item.status='interrupted';item.reason='INTERRUPTED';}
      else if(step.dependsOn?.some(id=>result.steps.find(s=>s.id===id)?.status!=='passed'))item.reason='DEPENDENCY_NOT_PASSED';
      else {
        try{item.reason=await step.preflight?.()??null;}catch{item.reason='PREFLIGHT_FAILED';}
        if(!item.reason){
          item.log='日志/'+step.id+'.log';
          const run=await execute(step,env,join(runDirectory,item.log),options.signal);
          item.exitCode=run.exitCode;item.reason=run.reason;item.tests=parseTestCounts(run.text,step.format);
          item.status=run.reason==='INTERRUPTED'?'interrupted':run.exitCode===0&&!run.reason?'passed':'failed';
          if(item.status==='passed'&&step.format&&(!item.tests||!item.tests.total||item.tests.failed||item.tests.skipped||item.tests.cancelled||item.tests.todo)){
            item.status='incomplete';item.reason='TESTS_NOT_FULLY_EXECUTED';
          }
        }
      }
      item.finishedAt=new Date().toISOString();item.durationMs=Date.now()-t;
      await save();
      if(options.profile!=='runner-test')console.log(step.id+': '+item.status+(item.reason?' ('+item.reason+')':''));
    }
  } catch {result.errors.push('CHECK_EXECUTION_FAILED');}
  try {
    const after=await snapshot(historyDirs);result.history.afterSha256=digest(after);
    result.history.changes=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(p=>before[p]!==after[p]);
    result.history.unchanged=result.history.changes.length===0;
    for(const file of await filesUnder(runDirectory))if(file!==join(runDirectory,'运行记录.json'))result.files.push({path:relative(runDirectory,file),bytes:(await stat(file)).size,sha256:await hash(file)});
  }catch{result.errors.push('ARTIFACT_VERIFICATION_FAILED');}
  result.finishedAt=new Date().toISOString();result.durationMs=Date.now()-start;result.state='finished';
  result.passed=result.steps.length===options.steps.length&&result.steps.length>0&&result.steps.every(s=>s.status==='passed')&&result.history.unchanged&&result.errors.length===0;
  await save();return result;
}
