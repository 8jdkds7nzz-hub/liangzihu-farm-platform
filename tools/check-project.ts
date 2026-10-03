import {join,relative} from 'node:path';import {PROJECT_ROOT} from '../tests/support/artifacts';import {runVerification} from './verification';
import {checkSteps,type CheckProfile} from './check-suites';import {testEnvironment} from './check-environment';import {clearStoppedCheckLock} from './quality-state';
const args=process.argv.slice(2),profile=args[0]??'quick';
if(profile==='--help')console.log('check：快检；check:core：独立环境核心回归；check:delivery：完整工程回归。可追加 --retry-of <运行编号> 保留重跑关系。完整检查使用独立测试副本。');
else if(profile==='unlock'&&args.length===1){try{await clearStoppedCheckLock(join(PROJECT_ROOT,'.local/检查锁.json'));console.log('已清理确认无存活进程的本机检查锁。');}catch(e){console.error((e as Error).message);process.exitCode=1;}}
else if(!['quick','core','delivery'].includes(profile)||args.length>1&&(args.length!==3||args[1]!=='--retry-of'||!/^[a-zA-Z0-9_-]+$/.test(args[2]))) {console.error('INVALID_CHECK_ARGUMENT');process.exitCode=2;}
else{
 process.chdir(PROJECT_ROOT);const env=testEnvironment(),controller=new AbortController(),abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
 try{const result=await runVerification({profile,steps:checkSteps(profile as CheckProfile,env),env,signal:controller.signal,retryOf:args[2]});
  console.log(JSON.stringify({passed:result.passed,profile,report:relative(PROJECT_ROOT,join(result.runDirectory,'运行记录.json')),sourceUnchanged:result.source.unchanged,historyUnchanged:result.history.unchanged,errors:result.errors,steps:result.steps.map(s=>({id:s.id,status:s.status,reason:s.reason}))},null,2));process.exitCode=result.passed?0:1;
 }catch{console.error('CHECK_START_FAILED');process.exitCode=1;}finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
