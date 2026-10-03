import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {withDb} from '../support/db';
import {withApp} from '../support/app';
import {actorFixture,objectFixture,permit} from '../support/fixtures';
import {transaction} from '../../src/db/pool';
import {createLot} from '../../src/modules/inventory/catalog';
import {createProtectionPlan} from '../../src/modules/protection/plans';

test('R41 部分导入保留来源和失败行，改正后重试不重复成功作业',{timeout:90000},()=>withDb(async pool=>{
 const a=await actorFixture(pool,'technician'),objectId=await objectFixture(pool,a.id);
 await permit(pool,a.id,objectId,['read','record','review']);
 const plan=await transaction(async c=>{
  const lot=await createLot(c,a,{objectId,code:randomUUID(),product:'合成投入品',kind:'input',unit:'L',basis:'as_is',source:'仅测试',requestKey:randomUUID()});
  return createProtectionPlan(c,a,{objectId,title:'合成导入测试',crop:'测试作物',target:'工程验证',stage:'合成',inputLotId:lot.id,boundary:{type:'Polygon',coordinates:[[[114,30],[114.001,30],[114.001,30.001],[114,30.001],[114,30]]]},obstacles:'仅合成',sensitiveNote:'未用于现场',conditions:'仅软件验证',source:'合成测试',requestKey:randomUUID()});
 },pool);
 await withApp(pool,async app=>{
  const browser=await chromium.launch(),context=await browser.newContext(),page=await context.newPage();
  try{
   await context.addCookies([{name:'agri_session',value:await app.authenticate(a),url:app.origin}]);
   await page.goto(app.origin+'/protection');await page.getByText('离线批量导入作业',{exact:true}).click();
   const form=page.locator('form').filter({has:page.getByLabel('稳定来源或设备编号',{exact:true})});
   const at=new Date().toISOString(),row={planId:plan.id,operator:'合成操作者',startedAt:at,endedAt:at,track:[],unit:'L',materialQuantity:null,evidence:'仅工程测试'};
   const rows=[{...row,externalId:'first'},{...row,externalId:'second',unit:'kg'}];
   await form.getByLabel('稳定来源或设备编号').fill('合成来源');await form.getByLabel('导入内容预览').fill(JSON.stringify(rows));
   await form.getByRole('button',{name:'保存',exact:true}).click();await form.getByText(/已导入1行；1行未导入/).waitFor();
   assert.equal(await form.getByLabel('稳定来源或设备编号').inputValue(),'合成来源');
   assert.deepEqual(JSON.parse(await form.getByLabel('导入内容预览').inputValue()),rows);
   rows[1].unit='L';await form.getByLabel('导入内容预览').fill(JSON.stringify(rows));
   await form.getByRole('button',{name:'保存',exact:true}).click();await form.getByText(/已导入2行；0行未导入/).waitFor();
   assert.equal((await pool.query('SELECT count(*) FROM protection_executions')).rows[0].count,'2');
   assert.equal(await form.getByLabel('稳定来源或设备编号').inputValue(),'');
  }finally{await browser.close();}
 });
}));

test('R42 一二期共用配置表单换号后拒绝原草稿，同账号正常提交',{timeout:90000},()=>withDb(async pool=>{
 const first=await actorFixture(pool,'technician'),second=await actorFixture(pool,'technician'),objectId=await objectFixture(pool,first.id);
 for(const a of [first,second])await permit(pool,a.id,objectId,['read','configure']);
 await withApp(pool,async app=>{
  const browser=await chromium.launch(),context=await browser.newContext(),page=await context.newPage();
  try{
   const firstToken=await app.authenticate(first),secondToken=await app.authenticate(second);
   await context.addCookies([{name:'agri_session',value:firstToken,url:app.origin}]);await page.goto(app.origin+'/settings');await page.getByText('登记数据来源',{exact:true}).click();
   const form=page.locator('form').filter({has:page.getByLabel('来源编号',{exact:true})});
   await form.getByLabel('所属对象').selectOption(objectId);await form.getByLabel('来源编号').fill('OLD-DRAFT');await form.getByLabel('来源名称').fill('原账号草稿');await form.getByLabel('厂家或服务方').fill('合成测试');
   await context.addCookies([{name:'agri_session',value:secondToken,url:app.origin}]);await form.getByRole('button',{name:'保存',exact:true}).click();
   await form.getByRole('alert').filter({hasText:'当前账号已改变'}).waitFor({timeout:5000});
   assert.equal(await form.getByLabel('来源编号').inputValue(),'OLD-DRAFT');assert.equal((await pool.query('SELECT count(*) FROM data_sources')).rows[0].count,'0');
   await context.addCookies([{name:'agri_session',value:firstToken,url:app.origin}]);await form.getByRole('button',{name:'保存',exact:true}).click();await form.getByText('已保存',{exact:true}).waitFor();
   assert.equal((await pool.query('SELECT created_by FROM data_sources')).rows[0].created_by,first.id);
  }finally{await browser.close();}
 });
}));
