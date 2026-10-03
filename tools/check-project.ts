import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join, relative, resolve} from 'node:path';
import {parseEnv} from 'node:util';
import pg from 'pg';
import {chromium} from 'playwright';
import {PROJECT_ROOT} from '../tests/support/artifacts';
import {runVerification, type CheckStep} from './verification';

const option=process.argv[2]??'quick';
if(option==='--help') {
  console.log('pnpm check：类型+单元；pnpm check:delivery：完整工程检查。产物保存在.local/验证记录/，不会安装模型或连接开发库。完整检查须在独立工作树或已停止服务的目录运行。');
} else if(!['quick','delivery'].includes(option)||process.argv.length>3) {
  console.error('参数无效：只支持quick、delivery或--help。');process.exitCode=2;
} else {
  process.chdir(PROJECT_ROOT);
  const config=join(PROJECT_ROOT,'.env.test.local');
  const testConfig=option==='delivery'&&existsSync(config)?parseEnv(readFileSync(config,'utf8')):{};
  // Only TEST_DATABASE_URL is imported from the private file; no development identity or service secrets.
  const env:NodeJS.ProcessEnv={...process.env,TEST_DATABASE_URL:process.env.TEST_DATABASE_URL??testConfig.TEST_DATABASE_URL,
    IDENTITY_MFA_REQUIRED:'1',MODEL_CACHE_ROOT:resolve(process.env.MODEL_CACHE_ROOT??'.local/models')};
  delete env.DATABASE_URL;delete env.AGRI_CHECK_RUN_DIR;
  for(const name of Object.keys(env))if(name.endsWith('_ENABLED'))env[name]='0';
  for(const name of ['MODEL_EXTERNAL_ENABLED','NOTICE_EXTERNAL_ENABLED','WECOM_ENABLED','VOICE_ENABLED','SMS_ENABLED','RENKE_HTTP_ENABLED','CAMERA_READS_ENABLED','MEDIA_REMOTE_READS_ENABLED','QWEATHER_READS_ENABLED','DJI_OPENAPI_READS_ENABLED','EZVIZ_WEBHOOK_ENABLED','CROP_MODEL_EVALUATION_ENABLED'])env[name]='0';
  const cached=new Map<string,Promise<string|null>>();
  const once=(name:string,check:()=>Promise<string|null>|string|null)=>()=>{
    if(!cached.has(name))cached.set(name,Promise.resolve().then(check));return cached.get(name)!;
  };
  const database=once('database',async()=>{
    let url:URL;
    try{url=new URL(env.TEST_DATABASE_URL??'');if(!['postgres:','postgresql:'].includes(url.protocol)||url.pathname!=='/agri_test')return 'TEST_DATABASE_REQUIRED';}
    catch{return 'TEST_DATABASE_REQUIRED';}
    const client=new pg.Client({connectionString:env.TEST_DATABASE_URL,connectionTimeoutMillis:3000,statement_timeout:3000});
    try{await client.connect();return(await client.query('SELECT current_database() AS name')).rows[0].name==='agri_test'?null:'TEST_DATABASE_REQUIRED';}
    catch{return 'TEST_DATABASE_UNAVAILABLE';}finally{await client.end().catch(()=>{});}
  });
  const models=once('models',()=>{
    const specs=[
      ['Xenova/bge-small-zh-v1.5/75c43b069aac4d136ba6bc1122f995fedcfd2781',['config.json','tokenizer.json','tokenizer_config.json','onnx/model_quantized.onnx']],
      ['Xenova/yolos-tiny/e2f9c7673f0fa61849efe2b56a0d7774779ebb9d',['config.json','preprocessor_config.json','onnx/model_quantized.onnx']],
      ['onnx-community/siglip2-base-patch16-224-ONNX/ba1f3b0843f24bc5417d38e19c37b287d719b2f4',['config.json','tokenizer.json','tokenizer_config.json','preprocessor_config.json','onnx/model_quantized.onnx']],
    ] as const;
    try{return specs.every(([path,files])=>files.every(file=>statSync(join(env.MODEL_CACHE_ROOT!,path,file)).size>0))?null:'MODEL_FILES_MISSING';}
    catch{return 'MODEL_FILES_MISSING';}
  });
  const browser=once('browser',()=>existsSync(chromium.executablePath())?null:'CHROMIUM_MISSING');
  const python=once('python',()=>{try{execFileSync('python3',['--version'],{stdio:'pipe',timeout:3000});return null;}catch{return 'PYTHON_MISSING';}});
  const docker=once('docker',()=>{
    try{const url=new URL(env.TEST_DATABASE_URL??'');if(!['127.0.0.1','localhost'].includes(url.hostname)||url.port!=='55432'||url.username!=='agri_tester')return 'RESTORE_REQUIRES_LOCAL_TEST_CONTAINER';
      return execFileSync('docker',['inspect','--format','{{.State.Running}}','liangzihu-farm-db'],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:5000}).trim()==='true'?null:'TEST_CONTAINER_UNAVAILABLE';
    }catch{return 'TEST_CONTAINER_UNAVAILABLE';}
  });
  const needs=(...checks:(()=>Promise<string|null>)[])=>async()=>{for(const check of checks){const reason=await check();if(reason)return reason;}return null;};
  const nodeTests=(id:string,title:string,directory:string,extension='.test.ts'):CheckStep=>({id,title,command:process.execPath,
    args:['--import','tsx','--test','--test-reporter=tap','--test-concurrency=1',...readdirSync(directory).filter(f=>f.endsWith(extension)).sort().map(f=>join(directory,f))],format:'tap'});
  const script=(id:string,title:string,path:string):CheckStep=>({id,title,command:process.execPath,args:['--import','tsx',path]});
  const steps:CheckStep[]=[
    {id:'typecheck',title:'类型检查',command:'pnpm',args:['typecheck']},
    nodeTests('unit','全部单元测试','tests/unit'),
  ];
  if(option==='delivery')steps.push(
    {id:'build',title:'正式构建',command:'pnpm',args:['build']},
    {...nodeTests('database','全部隔离数据库测试','tests/integration'),preflight:needs(database,models)},
    {...nodeTests('browser-http','全部TS浏览器与HTTP测试','tests/acceptance'),dependsOn:['build'],preflight:needs(database,models,browser)},
    {...nodeTests('monitor','独立监测','tests/acceptance','.test.mjs')},
    {id:'archive',title:'Python归档检查',command:'python3',args:['tests/acceptance/wal-archive.test.py'],format:'unittest',preflight:python},
    {...script('retrieval','固定集本地检索评测','tools/evaluate.ts'),preflight:needs(database,models)},
    {...script('assistant','助手fixture工程评测','tools/evaluate-assistant.ts'),args:['--import','tsx','tools/evaluate-assistant.ts','--mode','fixture'],preflight:needs(database,models)},
    ...[['restore-phase1','ops/restore-check.ts'],['restore-phase2','ops/phase2-restore.ts'],['restore-phase3','ops/phase3-restore.ts'],['restore-phase4','ops/phase4-restore.ts']].map(([id,path])=>({...script(id,id,path),preflight:needs(database,docker,models)})),
  );
  const controller=new AbortController(),abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
  try{
    const result=await runVerification({profile:option,steps,env,signal:controller.signal});
    console.log(JSON.stringify({passed:result.passed,profile:option,report:relative(PROJECT_ROOT,join(result.runDirectory,'运行记录.json')),steps:result.steps.map(s=>({id:s.id,status:s.status,reason:s.reason})),historyUnchanged:result.history.unchanged},null,2));
    process.exitCode=result.passed?0:1;
  }catch{console.error('检查未完成；请查看本轮私有运行目录。');process.exitCode=1;}
  finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
