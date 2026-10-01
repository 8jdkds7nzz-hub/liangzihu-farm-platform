import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium,type Page } from 'playwright';
import { spawn,execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes,randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { readFile,writeFile } from 'node:fs/promises';
import { generate } from 'otplib';
import { withDb,requireTestDatabaseUrl } from '../support/db';
import { telemetryFixture } from '../support/telemetry';
import { actorFixture,permit } from '../support/fixtures';
import { hashPassword } from '../../src/modules/identity/password';
import { transaction } from '../../src/db/pool';
import { saveBatch } from '../../src/modules/registry/batches';
import { createRule,approveRule,enableRule } from '../../src/modules/alerts/rules';
import { persistBatch } from '../../src/modules/telemetry/ingest';

test('手机/电脑真实页面闭环、断网不假保存、重试防重、关闭依据、撤权与管理员MFA', {timeout:120_000}, async()=>withDb(async pool=>{
  const f=await telemetryFixture(pool),worker=await actorFixture(pool,'worker'),repair=await actorFixture(pool,'maintainer'),admin=await actorFixture(pool,'admin');
  const password=randomBytes(24).toString('hex'),passwordHash=await hashPassword(password),key=randomBytes(32).toString('hex');
  for(const [actor,name] of [[worker,'演练当班人员'],[repair,'演练维护人员'],[admin,'演练管理员']] as const)await pool.query('UPDATE users SET password_hash=$2,display_name=$3 WHERE id=$1',[actor.id,passwordHash,name]);
  await pool.query("UPDATE objects SET code='演练场区-A',name='合成演练场区' WHERE id=$1",[f.objectId]);
  await permit(pool,worker.id,f.objectId,['read','claim','record','close_alert']);await permit(pool,repair.id,f.objectId,['read','claim','record']);await permit(pool,admin.id,f.objectId,['read','configure','export']);
  const at=new Date();
  await transaction(async c=>{const batch=await saveBatch(c,f.actor,{objectId:f.objectId,code:'BROWSER-SYNTH',species:'合成物种',stage:'合成阶段',source:'浏览器演练，非现场数据',verified:true,startedAt:'2026-09-01T00:00:00Z'});const rule=await createRule(c,f.actor,{objectId:f.objectId,pointId:f.point.id,batchId:batch.id,name:'合成持续告警',comparison:'lt',threshold:5,durationMs:15_000,maxGapMs:30_000,maxAgeMs:60_000,severity:'severe',source:'浏览器合成测试，绝不作为农场阈值',effectiveFrom:'2026-09-01T00:00:00Z'},at);await approveRule(c,f.actor,rule.id,'合成测试审核',at);await enableRule(c,f.actor,rule.id,true,at);},pool);
  const schema=(await pool.query('SELECT current_schema() AS name')).rows[0].name,url=new URL(requireTestDatabaseUrl());url.searchParams.set('options','-c search_path='+schema+',public');
  const env={...process.env,DATABASE_URL:url.toString(),IDENTITY_ENCRYPTION_KEY:key};
  const readings=[40,20].map(seconds=>({...f.reading,sourceRecordId:'browser-'+seconds,sampledAt:new Date(at.getTime()-seconds*1000).toISOString(),receivedAt:at.toISOString(),value:1,rawValue:1}));
  await persistBatch(pool,{sourceId:f.source.id,raw:Buffer.from('{"synthetic_browser_samples":true}'),receivedAt:at.toISOString(),synthetic:true,expectedCursor:null,nextCursor:'browser1',readings},at);
  const runAlarms=()=>execFileSync(process.execPath,['--import','tsx','workers/alarms.ts','--once'],{env,stdio:'pipe',timeout:20_000});runAlarms();runAlarms();
  const alert=(await pool.query("SELECT id FROM alerts WHERE kind='measurement'")).rows[0];assert(alert,'合成测值尚未形成告警');
  const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=(reserve.address() as {port:number}).port;await new Promise<void>(r=>reserve.close(()=>r()));
  const origin='http://127.0.0.1:'+port,server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env:{...env,APP_ORIGIN:origin},stdio:'ignore'}),closed=once(server,'exit');
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;const scriptErrors:string[]=[],serverErrors:string[]=[];
  function observe(page:Page){page.on('pageerror',e=>scriptErrors.push(e.message));page.on('response',r=>{if(r.url().includes('/api/')&&r.status()>=500)serverErrors.push(new URL(r.url()).pathname+':'+r.status());});}
  async function login(page:Page,username:string){await page.goto(origin+'/login');await page.getByLabel('账号',{exact:true}).fill(username);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();}
  async function screenshot(page:Page,name:string){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false,'页面存在横向溢出');await page.screenshot({path:'docs/acceptance/1a/'+name,fullPage:true});}
  try{
    let ready=false;for(let i=0;i<100;i++){if(server.exitCode!==null)break;try{if((await fetch(origin+'/api/v1/health/live')).ok){ready=true;break;}}catch{}await delay(100);}assert(ready,'隔离浏览器服务器未启动');
    browser=await chromium.launch({headless:true});
    const mobile=await browser.newContext({viewport:{width:390,height:844},locale:'zh-CN',timezoneId:'Asia/Shanghai'}),desktop=await browser.newContext({viewport:{width:1280,height:900},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
    const phone=await mobile.newPage(),desk=await desktop.newPage();for(const page of [phone,desk])observe(page);
    await login(phone,worker.id);await phone.waitForURL(origin+'/account');
    await phone.goto(origin+'/objects');await phone.getByRole('link',{name:'演练场区-A',exact:true}).click();await phone.getByRole('heading',{name:'合成演练场区',exact:true}).waitFor();
    await phone.getByRole('link',{name:'合成测试测点',exact:true}).click();await phone.locator('svg.history-curve').waitFor();await screenshot(phone,'A11-history-mobile.png');
    await phone.goto(origin+'/alerts/'+alert.id);await phone.getByRole('heading',{name:'合成持续告警',exact:true}).waitFor();
    const claimRequest=phone.waitForRequest(r=>r.url().endsWith('/claim')&&r.method()==='POST');await phone.getByRole('button',{name:'认领现场核查',exact:true}).click();const request=await claimRequest;
    await phone.getByLabel('现场观察、复测结果与依据').waitFor();
    const retry=await mobile.request.post(origin+'/api/v1/alerts/'+alert.id+'/claim',{headers:{Origin:origin},data:request.postDataJSON()});assert.equal(retry.status(),200);
    assert.equal(Number((await pool.query("SELECT count(*) FROM alert_claims WHERE alert_id=$1 AND purpose='field_check'",[alert.id])).rows[0].count),1);
    await phone.getByLabel('现场观察、复测结果与依据').fill('合成核查：已到现场并按测试记录复核。');await mobile.setOffline(true);await phone.getByRole('button',{name:'保存现场核查',exact:true}).click();
    await phone.getByText('网络不可用，尚未确认保存，请恢复网络后重试。',{exact:true}).waitFor();assert.equal(Number((await pool.query("SELECT count(*) FROM alert_events WHERE alert_id=$1 AND event_type='field_check'",[alert.id])).rows[0].count),0);
    await mobile.setOffline(false);await phone.getByRole('button',{name:'保存现场核查',exact:true}).click();await phone.locator('.event-list').getByText('合成核查：已到现场并按测试记录复核。',{exact:true}).waitFor();
    const field=(await pool.query("SELECT id FROM alert_events WHERE alert_id=$1 AND event_type='field_check'",[alert.id])).rows[0];
    await login(desk,repair.id);await desk.waitForURL(origin+'/account');await desk.goto(origin+'/objects');await desk.getByRole('link',{name:'演练场区-A',exact:true}).waitFor();await screenshot(desk,'A11-objects-desktop.png');
    await desk.goto(origin+'/alerts/'+alert.id);await desk.getByRole('button',{name:'认领排障',exact:true}).click();await desk.getByLabel('已采取的措施、结果和依据').fill('合成处置：完成测试维修并申请复核。');await desk.getByRole('button',{name:'保存处置记录',exact:true}).click();await desk.locator('.event-list').getByText('合成处置：完成测试维修并申请复核。',{exact:true}).waitFor();
    const repairEvent=(await pool.query("SELECT id FROM alert_events WHERE alert_id=$1 AND event_type='repair'",[alert.id])).rows[0];
    await phone.reload();await phone.getByText('引用核查和处置记录后关闭',{exact:true}).click();await phone.getByLabel('核查记录',{exact:true}).selectOption(field.id);await phone.getByLabel('处置记录',{exact:true}).selectOption(repairEvent.id);await phone.getByRole('button',{name:'关闭此事件',exact:true}).click();
    await phone.getByText('尚未恢复；误报须经专业审核后才能关闭',{exact:true}).waitFor();assert.equal((await pool.query('SELECT state FROM alerts WHERE id=$1',[alert.id])).rows[0].state,'open');
    const recoveredAt=new Date();await persistBatch(pool,{sourceId:f.source.id,raw:Buffer.from('{"synthetic_recovery":true}'),receivedAt:recoveredAt.toISOString(),synthetic:true,expectedCursor:'browser1',nextCursor:'browser2',readings:[{...f.reading,sourceRecordId:'browser-normal',sampledAt:recoveredAt.toISOString(),receivedAt:recoveredAt.toISOString(),value:10,rawValue:10}]},recoveredAt);runAlarms();
    assert.equal((await pool.query('SELECT state FROM alerts WHERE id=$1',[alert.id])).rows[0].state,'recovered');await phone.getByRole('button',{name:'关闭此事件',exact:true}).click();await phone.getByText('已关闭',{exact:true}).waitFor();await phone.getByText('尚无通知记录，不能推定已发送或已送达。',{exact:true}).waitFor();assert.equal(await phone.locator('p.form-error').count(),0);await screenshot(phone,'A11-alert-mobile.png');
    await desk.reload();await desk.getByText('已关闭',{exact:true}).waitFor();
    await phone.getByRole('link',{name:'问题反馈',exact:true}).click();await phone.getByLabel('问题关联对象',{exact:true}).selectOption(f.objectId);await phone.getByLabel('问题标题',{exact:true}).fill('合成反馈：手机入口核对');await phone.getByLabel('操作步骤、看到的现象和预期结果').fill('合成演练：请管理员核对本次页面操作记录。');await phone.getByRole('button',{name:'提交问题',exact:true}).click();await phone.getByRole('heading',{name:'合成反馈：手机入口核对 · 待处理',exact:true}).waitFor();
    await pool.query("UPDATE grants SET revoked_at=now() WHERE user_id=$1 AND object_id=$2 AND action='read'",[worker.id,f.objectId]);await phone.goto(origin+'/points/'+f.point.id);await phone.getByText('没有此对象或操作的权限',{exact:true}).waitFor();assert.equal(await phone.locator('svg.history-curve').count(),0);
    const manager=await browser.newContext({viewport:{width:1280,height:900},locale:'zh-CN',timezoneId:'Asia/Shanghai'}),adminPage=await manager.newPage();observe(adminPage);
    await login(adminPage,admin.id);await adminPage.locator('#factor-secret').waitFor();const secret=await adminPage.locator('#factor-secret').inputValue();await adminPage.getByLabel('验证码或恢复码').fill(await generate({secret}));await adminPage.getByRole('button',{name:'验证并进入'}).click();await adminPage.getByRole('button',{name:'已保存，进入平台'}).click();await adminPage.waitForURL(origin+'/account');
    await adminPage.goto(origin+'/operations');await adminPage.getByText('当前尚未全部就绪，请查看下方缺口；不能接管现场值守。',{exact:true}).waitFor();await screenshot(adminPage,'A11-operations-desktop.png');
    for(const [path,title] of [['/rules','规则与专业审核'],['/duty','值班与通知联系人'],['/maintenance','维护、复测与导出'],['/settings','配置管理']]){await adminPage.goto(origin+path);await adminPage.getByRole('heading',{name:title,exact:true}).waitFor();await adminPage.waitForLoadState('networkidle');assert.equal(await adminPage.locator('p.form-error').count(),0,'管理员页面加载错误：'+path);}
    await adminPage.goto(origin+'/feedback');await adminPage.getByLabel('处理状态',{exact:true}).selectOption('resolved');await adminPage.getByLabel('处理结果或后续安排').fill('已核对，作为合成演练记录关闭。');await adminPage.getByRole('button',{name:'登记处理进展',exact:true}).click();await adminPage.getByRole('heading',{name:'合成反馈：手机入口核对 · 已处理',exact:true}).waitFor();
    assert.deepEqual(scriptErrors,[]);assert.deepEqual(serverErrors,[]);
    const report={checkedAt:new Date().toISOString(),buildId:(await readFile('.next/BUILD_ID','utf8')).trim(),environment:'agri_test随机schema与合成数据',viewports:['390x844','1280x900'],checks:{objectToPointHistory:true,sharedAlertAcrossDevices:true,requestRetryIdempotent:true,offlineDoesNotPretendSaved:true,fieldAndRepairSeparated:true,unrecoveredCloseRejected:true,evidenceBasedClose:true,revocationImmediate:true,adminMfa:true,noPageOverflow:true,noBrowserErrors:true,noApiServerErrors:true,feedbackSubmittedAndResolved:true},recordIds:{objectId:f.objectId,pointId:f.point.id,alertId:alert.id,fieldCheckId:field.id,repairId:repairEvent.id},limits:['未模拟真实企业微信或电话送达','未验证离线草稿和照片；这些属于1b']};
    await writeFile('docs/acceptance/1a/A11浏览器实测.json',JSON.stringify(report,null,2)+'\n');
  }finally{await browser?.close();server.kill('SIGTERM');const kill=setTimeout(()=>server.kill('SIGKILL'),5000);try{await closed;}finally{clearTimeout(kill);}}
}));
