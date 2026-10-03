import {existsSync,readdirSync,statSync} from 'node:fs';import {join,resolve} from 'node:path';import {execFileSync} from 'node:child_process';import {chromium} from 'playwright';
import type {CheckStep} from './verification';import {checkTestEnvironment,isolatedFilesReason} from './check-environment';
export type CheckProfile='quick'|'core'|'delivery';
export function nodeTestStep(id:string,title:string,directory:string,names?:string[],extension='.test.ts'):CheckStep {
 const files=names??readdirSync(directory).filter(f=>f.endsWith(extension)).sort();
 return {id,title,command:process.execPath,args:['--import','tsx','--test','--test-reporter=tap','--test-concurrency=1',...files.map(f=>join(directory,f))],testFiles:files.map(f=>join(directory,f)),format:'tap',preflight:()=>files.length&&files.every(f=>existsSync(join(directory,f)))?null:'TEST_FILES_MISSING'};
}
export function checkSteps(profile:CheckProfile,env:NodeJS.ProcessEnv):CheckStep[] {
 let environment:Promise<string|null>|undefined;const ready=()=>environment??=(checkTestEnvironment(env));
 const model=()=>{const paths=['Xenova/bge-small-zh-v1.5/75c43b069aac4d136ba6bc1122f995fedcfd2781','Xenova/yolos-tiny/e2f9c7673f0fa61849efe2b56a0d7774779ebb9d','onnx-community/siglip2-base-patch16-224-ONNX/ba1f3b0843f24bc5417d38e19c37b287d719b2f4'];try{return paths.every(p=>['config.json','onnx/model_quantized.onnx'].every(f=>statSync(join(resolve(env.MODEL_CACHE_ROOT??'.local/models'),p,f)).size>0))?null:'MODEL_FILES_MISSING';}catch{return 'MODEL_FILES_MISSING';}};
 const browser=()=>existsSync(chromium.executablePath())?null:'CHROMIUM_MISSING';
 const guarded=(step:CheckStep,checks:(()=>Promise<string|null>|string|null)[]=[]):CheckStep=>{const original=step.preflight;return {...step,preflight:async()=>{for(const fn of [ready,...checks,...(original?[original]:[])]){const r=await fn();if(r)return r;}return null;}};};
 const script=(id:string,title:string,path:string,args:string[]=[]):CheckStep=>({id,title,command:process.execPath,args:['--import','tsx',path,...args]});
 const steps:CheckStep[]=[{id:'typecheck',title:'类型检查',command:'pnpm',args:['typecheck']},nodeTestStep('unit','全部单元','tests/unit')];
 if(profile==='quick')return steps;
 steps.push({id:'environment',title:'独立环境核查',command:process.execPath,args:['-e','process.exit(0)'],preflight:ready},
 {id:'build',title:'正式构建',command:'pnpm',args:['build'],dependsOn:['environment'],preflight:()=>isolatedFilesReason()});
 const dbCore=['database.test.ts','access.test.ts','session.test.ts','jobs.test.ts','registry.test.ts','claims.test.ts','phase3-stock.test.ts','phase4-prior-boundaries.test.ts','phase4-subsidy-time.test.ts'];
 const webCore=['identity-http.test.ts','platform-browser.test.ts','phase3-inventory-browser.test.ts','phase4-regression-browser.test.ts','health-http.test.ts'];
 steps.push(guarded(nodeTestStep('database',profile==='core'?'核心数据库子集':'全部隔离数据库','tests/integration',profile==='core'?dbCore:undefined),profile==='delivery'?[model]:[]),
  {...guarded(nodeTestStep('browser-http',profile==='core'?'核心HTTP浏览器子集':'全部HTTP浏览器','tests/acceptance',profile==='core'?webCore:undefined),profile==='delivery'?[model,browser]:[browser]),dependsOn:['build']},
  nodeTestStep('monitor','独立监测','tests/acceptance',undefined,'.test.mjs'),
  {id:'archive',title:'Python归档',command:'python3',args:['tests/acceptance/wal-archive.test.py'],format:'unittest',preflight:()=>{try{execFileSync('python3',['--version'],{stdio:'pipe',timeout:3000});return null;}catch{return 'PYTHON_MISSING';}}},
  script('coverage','需求与引用对照','tools/check-coverage.ts'));
 if(profile==='delivery')steps.push(
  guarded(script('retrieval','本地检索评测','tools/evaluate.ts'),[model]),guarded(script('assistant','助手工程评测','tools/evaluate-assistant.ts',['--mode','fixture']),[model]),
  ...[['restore-phase1','ops/restore-check.ts'],['restore-phase2','ops/phase2-restore.ts'],['restore-phase3','ops/phase3-restore.ts'],['restore-phase4','ops/phase4-restore.ts']].map(([id,path])=>guarded(script(id,id,path),[model])),
 );return steps;
}
