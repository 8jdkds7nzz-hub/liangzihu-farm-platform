import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {chromium} from 'playwright';import {mkdir} from 'node:fs/promises';
import {withDb} from '../support/db';import {withApp} from '../support/app';import {actorFixture,objectFixture,permit} from '../support/fixtures';import {releaseTestLot} from '../support/stock';import {transaction} from '../../src/db/pool';import {createLot} from '../../src/modules/inventory/catalog';import {draftCard} from '../../src/modules/traceability/public';
test('3B网页独立审核客户页、匿名白名单读取、撤回后404',{timeout:120000},()=>withDb(async pool=>{
 const creator=await actorFixture(pool,'technician'),objectId=await objectFixture(pool,creator.id);await permit(pool,creator.id,objectId,['read','record','review','share']);
 const lot=await transaction(c=>createLot(c,creator,{objectId,code:randomUUID(),product:'合成客户页产品',kind:'processed',unit:'kg',basis:'as_is',source:'测试',requestKey:randomUUID()}),pool),f=await releaseTestLot(pool,creator,objectId,lot.id);
 const card=await transaction(c=>draftCard(c,creator,{lotId:lot.id,content:{productName:lot.product,batchLabel:'公开标签',province:'湖北省',city:'鄂州市',county:'梁子湖区',harvestMonth:'2026-10',productionSummary:'工程测试资料',testSummary:'仅合成报告',limitations:'不用于实物证明'},validUntil:new Date(Date.now()+86400000).toISOString(),credentialIds:[],requestKey:randomUUID()}),pool);
 await withApp(pool,async app=>{
 const browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();try{
 await context.addCookies([{name:'agri_session',value:await app.authenticate(f.reviewer),url:app.origin}]);await page.goto(app.origin+'/traceability');await page.getByText('客户查询页',{exact:true}).click();
 const form=page.locator('form').filter({has:page.getByLabel('页面审核操作',{exact:true})});await form.getByLabel('客户页面版本',{exact:true}).selectOption(card.id);await form.getByLabel('页面审核操作',{exact:true}).selectOption('approve');await form.getByLabel('核实或操作依据',{exact:true}).fill('独立审核合成公开信息');await form.getByRole('button',{name:'保存',exact:true}).click();await form.getByText('已保存',{exact:true}).waitFor();
 const response=await fetch(app.origin+'/api/v1/public/trace/'+card.code),body=await response.json();assert.equal(response.status,200);assert.match(response.headers.get('cache-control')! ,/no-store/);assert.equal(JSON.stringify(body).includes(objectId),false);assert.equal(JSON.stringify(body).includes(lot.id),false);
 const publicContext=await browser.newContext({viewport:{width:390,height:844}}),customer=await publicContext.newPage();await customer.goto(app.origin+'/trace/'+card.code);await customer.getByRole('heading',{name:lot.product,exact:true}).waitFor();await mkdir('docs/acceptance/3b',{recursive:true});await customer.screenshot({path:'docs/acceptance/3b/客户页手机合成实测.png',fullPage:true});await publicContext.close();
 await form.getByLabel('客户页面版本',{exact:true}).selectOption(card.id);await form.getByLabel('页面审核操作',{exact:true}).selectOption('revoke');await form.getByLabel('核实或操作依据',{exact:true}).fill('合成撤回');await form.getByRole('button',{name:'保存',exact:true}).click();await form.getByText('已保存',{exact:true}).waitFor();
 assert.equal((await fetch(app.origin+'/api/v1/public/trace/'+card.code)).status,404);
 }finally{await browser.close();}
 });
}));

