import {artifactPath} from '../support/artifacts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {withDb} from '../support/db';
import {withApp} from '../support/app';
import {telemetryFixture} from '../support/telemetry';
import {actorFixture,permit} from '../support/fixtures';
import {transaction} from '../../src/db/pool';
import {saveBoundary} from '../../src/modules/map/service';
import {createTask,transitionTask} from '../../src/modules/tasks/service';
import {createBriefing,reviewItem} from '../../src/modules/briefings/service';
import {submitRecord} from '../../src/modules/records/service';

test('一期新增浏览器：地图图层/平移、交班、简报预览/接收/撤回及管理员恢复', {timeout:120000},()=>withDb(async pool=>{
 const f=await telemetryFixture(pool),a=f.actor,one=await actorFixture(pool,'worker'),two=await actorFixture(pool,'worker'),owner=await actorFixture(pool,'owner'),admin=await actorFixture(pool,'admin');
 await permit(pool,a.id,f.objectId,['dispatch','share']);for(const w of [one,two])await permit(pool,w.id,f.objectId,['read','record','claim']);await permit(pool,owner.id,f.objectId,['read']);
 await transaction(c=>saveBoundary(c,a,{objectId:f.objectId,version:1,sourceCrs:4326,status:'verified',source:'合成浏览器地图',geometry:{type:'Polygon',coordinates:[[[114,30],[114.01,30],[114.01,30.01],[114,30.01],[114,30]]]}}),pool);
 let task=await transaction(c=>createTask(c,a,{objectId:f.objectId,title:'合成浏览器交班',instructions:'合成现场核查',kind:'inspection',requestKey:randomUUID()}),pool);
 task=await transaction(c=>transitionTask(c,a,{id:task.id,version:task.version,action:'dispatch',assigneeId:one.id,confirm:true,note:'仅工程测试',requestKey:randomUUID()}),pool);
 task=await transaction(c=>transitionTask(c,one,{id:task.id,version:task.version,action:'claim',note:'合成领取',requestKey:randomUUID()}),pool);
 await transaction(c=>submitRecord(c,a,{objectId:f.objectId,objectVersion:2,submissionId:randomUUID(),kind:'inspection',occurredAt:'2026-10-01T01:00:00Z',content:{observation:'合成简报浏览器事实'},attachmentIds:[]}),pool);
 const b=await transaction(c=>createBriefing(c,a,{objectIds:[f.objectId],period:'daily',from:'2026-10-01T00:00:00Z',to:'2026-10-02T00:00:00Z',requestKey:randomUUID()}),pool),items=(await pool.query('SELECT * FROM briefing_items WHERE briefing_id=$1',[b.id])).rows;
 for(const i of items)await transaction(c=>reviewItem(c,a,{id:i.id,version:i.version,decision:'adopted',reason:'合成核对，保留不足',requestKey:randomUUID()}),pool);
 await withApp(pool,async app=>{const browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1280,height:900},timezoneId:'Asia/Shanghai',locale:'zh-CN'}),page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await context.addCookies([{name:'agri_session',value:await app.authenticate(a),url:app.origin}]);
   await page.goto(app.origin+'/map');const svg=page.getByRole('img',{name:'对象、航次、影像与疑点地图'});await svg.waitFor();
   await page.getByLabel('对象边界',{exact:true}).uncheck();assert.equal(await svg.locator('a path').count(),0);await page.getByLabel('对象边界',{exact:true}).check();assert.equal(await svg.locator('a path').count(),1);
   await svg.scrollIntoViewIfNeeded();const before=await svg.getAttribute('viewBox'),box=(await svg.boundingBox())!;await page.mouse.move(box.x+box.width*.7,box.y+box.height*.7);await page.mouse.down();await page.mouse.move(box.x+box.width*.7+40,box.y+box.height*.7+30,{steps:5});await page.mouse.up();await page.waitForFunction(initial=>document.querySelector('svg.farm-map')?.getAttribute('viewBox')!==initial,before,{timeout:5000});assert.notEqual(await svg.getAttribute('viewBox'),before);await page.getByRole('button',{name:'复位视图'}).click();assert.equal(await svg.getAttribute('viewBox'),before);
   await page.goto(app.origin+'/tasks');const card=page.locator('section.rule-card').filter({has:page.getByRole('heading',{name:/合成浏览器交班/})});await card.getByText('重新指派并交班',{exact:true}).click();await card.getByLabel('新的执行人账号ID').fill(two.id);await card.getByLabel('交班原因和未完成内容').fill('合成浏览器交班记录');await card.locator('input[name=confirm]').check();await card.getByRole('button',{name:'确认交给新的执行人'}).click();await card.getByRole('heading',{name:'合成浏览器交班 · 已人工派发'}).waitFor();assert.equal((await pool.query('SELECT assignee_id,claimed_by FROM field_tasks WHERE id=$1',[task.id])).rows[0].assignee_id,two.id);
   await page.goto(app.origin+'/briefings');await page.getByText('确认老板、工人或专家访问范围',{exact:true}).click();const pub=page.locator('form').filter({has:page.getByRole('button',{name:'预览接收版本'})});await pub.getByLabel('接收人账号ID').fill(owner.id);await pub.getByLabel('已审阅事项ID列表').fill(JSON.stringify(items.map(i=>i.id)));await pub.getByLabel('访问截止时间').fill(new Date(Date.now()+3600000+8*3600000).toISOString().slice(0,16));await pub.locator('input[name=confirm]').check();await pub.getByRole('button',{name:'预览接收版本'}).click();await pub.getByRole('heading',{name:'老板版预览'}).waitFor();assert.equal((await pool.query('SELECT count(*) FROM briefing_publications')).rows[0].count,'0');await pub.getByRole('button',{name:'记录确认范围'}).click();await pub.getByText('已登记访问范围，尚未发送消息。',{exact:true}).waitFor();const publication=(await pool.query('SELECT id FROM briefing_publications')).rows[0];
   const ownerContext=await browser.newContext({viewport:{width:390,height:844}}),ownerPage=await ownerContext.newPage();try{await ownerContext.addCookies([{name:'agri_session',value:await app.authenticate(owner),url:app.origin}]);await ownerPage.goto(app.origin+'/briefings/shared/'+publication.id);await ownerPage.getByRole('heading',{name:/已分享简报/}).waitFor();await ownerPage.getByText('合成简报浏览器事实',{exact:false}).waitFor();assert.equal(await ownerPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.getByLabel('撤回理由').fill('合成撤回浏览器核对');await page.getByRole('button',{name:'撤回本次访问'}).click();await page.getByText(/owner版 · 已撤回/).waitFor();await ownerPage.reload();await ownerPage.getByText(/撤回|失效|不存在/).first().waitFor();}finally{await ownerContext.close();}
   await context.addCookies([{name:'agri_session',value:await app.authenticate(admin),url:app.origin}]);await page.goto(app.origin+'/settings');await page.getByText('人工核验后的账号恢复',{exact:true}).click();const form=page.locator('form').filter({has:page.getByRole('button',{name:'授权一次恢复'})});await form.getByLabel('需要恢复的账号').selectOption(two.id);await form.getByLabel('核验记录编号/方式').fill('合成身份核验');await form.getByLabel('恢复理由').fill('合成密码遗失');await form.locator('input[name=confirmIdentity]').check();await form.getByRole('button',{name:'授权一次恢复'}).click();await page.getByText('仅显示本次的一次性恢复码（30分钟有效）').waitFor();await page.getByRole('button',{name:'已交付，清除本页显示'}).click();assert.equal(await page.locator('code').filter({hasText:/^[a-f0-9]{64}$/}).count(),0);
   assert.deepEqual(errors,[]);await writeFile(artifactPath('验收/一期补齐/新增流程.json'),JSON.stringify({checkedAt:new Date().toISOString(),environment:'agri_test随机schema、合成人员和资料',checks:{mapLayers:true,mapPan:true,taskReassignment:true,publicationPreviewNoWrite:true,recipientMobileRead:true,revokeRecipientRead:true,adminRecoveryCodeCleared:true,noScriptErrors:true},actualDevices:false},null,2));
  }finally{await browser.close();}
 });
}));
