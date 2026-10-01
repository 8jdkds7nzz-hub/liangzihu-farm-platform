import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { readFile,writeFile } from 'node:fs/promises';
function validUrl(value){const url=new URL(value);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw Error('monitor URL must use HTTPS');return url;}
export async function checkOnce(config){
  let healthy=false,status=null;
  try{const r=await fetch(validUrl(config.readyUrl),{headers:{Authorization:'Bearer '+config.token},signal:AbortSignal.timeout(5000),redirect:'error'});status=r.status;const data=await r.json();healthy=r.ok&&data.ready===true;}catch{}
  let notification='not_needed';
  if(!healthy){
    notification='not_configured';
    if(config.allowSend&&config.alertUrl){try{const r=await fetch(validUrl(config.alertUrl),{method:'POST',headers:{'Content-Type':'application/json',...(config.alertToken?{Authorization:'Bearer '+config.alertToken}:{})},body:JSON.stringify({requestKey:config.requestKey??randomUUID(),event:'farm_platform_unavailable',occurredAt:new Date().toISOString(),status,action:'请管理员排障并联系必要的当班人员转现场核查'}),signal:AbortSignal.timeout(5000),redirect:'error'});notification=r.ok?'accepted':'failed';}catch{notification='unknown';}}
  }
  return {healthy,status,notification,checkedAt:new Date().toISOString()};
}
async function main(){
  const statePath='.local/独立健康检查状态.json';let state={healthy:true,requestKey:randomUUID(),attempted:false};
  try{state=JSON.parse(await readFile(statePath,'utf8'));}catch{}
  let stopped=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopped=true;});
  do{
    const report=await checkOnce({readyUrl:process.env.HEALTH_READY_URL,token:process.env.HEALTHCHECK_TOKEN,alertUrl:process.env.HEALTH_ALERT_WEBHOOK,alertToken:process.env.HEALTH_ALERT_TOKEN,allowSend:process.env.HEALTH_ALERT_SEND_APPROVED==='1'&&!state.attempted,requestKey:state.requestKey});
    if(report.healthy)state={healthy:true,requestKey:randomUUID(),attempted:false};
    else state={...state,healthy:false,attempted:state.attempted||['accepted','unknown'].includes(report.notification)};
    await writeFile(statePath,JSON.stringify(state),{mode:0o600});console.log(JSON.stringify(report));
    if(process.argv.includes('--once')){if(!report.healthy)process.exitCode=1;break;}
    await delay(30_000);
  }while(!stopped);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('独立监测器配置或本地状态文件不可用；未输出地址、令牌和联系人。');process.exitCode=1;});
