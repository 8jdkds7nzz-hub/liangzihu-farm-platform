import { readFile,writeFile,chmod,mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
async function main(){
  let content=await readFile('.env.local','utf8');const env=parseEnv(content);let token=env.HEALTHCHECK_TOKEN;
  if(!token){token=randomBytes(32).toString('hex');content+=(content.endsWith('\n')?'':'\n')+'HEALTHCHECK_TOKEN='+token+'\n';await writeFile('.env.local',content,{mode:0o600});}
  if(!/^[a-f0-9]{64}$/.test(token))throw Error('invalid token');await chmod('.env.local',0o600);await mkdir('.local',{recursive:true,mode:0o700});
  let monitor='';try{monitor=await readFile('.env.health.local','utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
  const existing=parseEnv(monitor);if(existing.HEALTHCHECK_TOKEN&&existing.HEALTHCHECK_TOKEN!==token)throw Error('mismatched monitor token');
  const entries={HEALTH_READY_URL:(env.APP_ORIGIN??'http://127.0.0.1:3100')+'/api/v1/health/ready',HEALTHCHECK_TOKEN:token,HEALTH_ALERT_SEND_APPROVED:'0'};
  const missing=Object.entries(entries).filter(([key])=>existing[key]===undefined).map(([key,value])=>key+'='+value);
  if(missing.length)await writeFile('.env.health.local',monitor+(monitor&&!monitor.endsWith('\n')?'\n':'')+missing.join('\n')+'\n',{mode:0o600});await chmod('.env.health.local',0o600);
  console.log('健康检查凭据已在本机私有环境文件中配置；外部通知发送仍关闭，未输出凭据。');
}
main().catch(()=>{console.error('健康检查配置未完成，请核对本机环境文件，未输出秘密。');process.exitCode=1;});
