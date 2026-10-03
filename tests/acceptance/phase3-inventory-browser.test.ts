import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';import {mkdir} from 'node:fs/promises';
import {withDb} from '../support/db';import {withApp} from '../support/app';import {actorFixture,objectFixture,permit} from '../support/fixtures';
test('3A真实页面登记仓位批次入库，HTTP匿名/跨站拒绝，撤权后不保留库存',{timeout:120000},()=>withDb(async pool=>{
 const actor=await actorFixture(pool,'technician'),objectId=await objectFixture(pool,actor.id);await permit(pool,actor.id,objectId,['read','record','review','export']);
 await withApp(pool,async app=>{assert.equal((await fetch(app.origin+'/api/v1/inventory/overview?objectId='+objectId)).status,401);
 const browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
 try{await context.addCookies([{name:'agri_session',value:await app.authenticate(actor),url:app.origin}]);await page.goto(app.origin+'/inventory');
 await page.getByText('登记仓位',{exact:true}).click();const warehouse=page.locator('form').filter({has:page.getByLabel('仓位编号',{exact:true})});
 await warehouse.getByLabel('仓位编号',{exact:true}).fill('TEST-W');await warehouse.getByLabel('仓位名称',{exact:true}).fill('合成仓位');await warehouse.getByRole('button',{name:'保存',exact:true}).click();await warehouse.getByText('已保存',{exact:true}).waitFor();
 await page.getByText('登记批次',{exact:true}).click();const batch=page.locator('form').filter({has:page.getByLabel('全局库存批号',{exact:true})});
 await batch.getByLabel('全局库存批号',{exact:true}).fill('TEST-LOT');await batch.getByLabel('品名',{exact:true}).fill('合成投入品');await batch.getByLabel('批次类型').selectOption('input');await batch.getByLabel('库存单位').selectOption('kg');await batch.getByLabel('数量口径').selectOption('as_is');await batch.getByLabel('来源依据').fill('仅浏览器工程测试');await batch.getByRole('button',{name:'保存',exact:true}).click();await batch.getByText('已保存',{exact:true}).waitFor();
 const lot=(await pool.query("SELECT id FROM stock_lots")).rows[0],location=(await pool.query("SELECT id FROM stock_locations")).rows[0];
 await page.getByText('库存操作',{exact:true}).click();const move=page.locator('form').filter({has:page.getByLabel('库存动作',{exact:true})});
 await move.getByLabel('库存批次',{exact:true}).selectOption(lot.id);await move.getByLabel('当前仓位',{exact:true}).selectOption(location.id);await move.getByLabel('实际数量',{exact:true}).fill('12.5');await move.getByLabel('实际发生时间',{exact:true}).fill('2026-10-03T10:00');await move.getByLabel('操作依据',{exact:true}).fill('合成收货单');await move.getByRole('button',{name:'保存',exact:true}).click();await move.getByText('已保存',{exact:true}).waitFor();
 assert.equal((await pool.query('SELECT sum(delta)::text AS q FROM stock_entries')).rows[0].q,'12.500000');
 assert.equal((await context.request.post(app.origin+'/api/v1/inventory/movements',{headers:{origin:'https://outside.invalid'},data:{}})).status(),403);
 await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.querySelector('.app-sidebar')!.getBoundingClientRect().right<=1);await page.evaluate(()=>scrollTo(0,0));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 await mkdir('docs/acceptance/3a',{recursive:true});await page.screenshot({path:'docs/acceptance/3a/库存手机合成实测.png',fullPage:true});
 await pool.query('UPDATE grants SET revoked_at=now() WHERE user_id=$1',[actor.id]);await page.reload();await page.getByText('先在配置管理登记对象并取得授权。').waitFor();
 }catch(e){console.log((await page.locator('.form-error').allTextContents()).join(';'));await page.screenshot({path:'.local/3a-failure.png',fullPage:true});throw e;}finally{await browser.close();}
 });
}));

test('3A旧标签页切换账号后阻止误提交，并保留原输入',{timeout:120000},()=>withDb(async pool=>{
 const first=await actorFixture(pool,'technician'),second=await actorFixture(pool,'technician'),objectId=await objectFixture(pool,first.id);for(const a of [first,second])await permit(pool,a.id,objectId,['read','record']);
 await withApp(pool,async app=>{const browser=await chromium.launch(),context=await browser.newContext(),page=await context.newPage();try{
 await context.addCookies([{name:'agri_session',value:await app.authenticate(first),url:app.origin}]);await page.goto(app.origin+'/inventory');await page.getByText('登记仓位',{exact:true}).click();const form=page.locator('form').filter({has:page.getByLabel('仓位编号',{exact:true})});
 await form.getByLabel('仓位编号',{exact:true}).fill('OLD-DRAFT');await form.getByLabel('仓位名称',{exact:true}).fill('原账号待提交草稿');
 await context.addCookies([{name:'agri_session',value:await app.authenticate(second),url:app.origin}]);await form.getByRole('button',{name:'保存',exact:true}).click();await form.getByRole('alert').filter({hasText:'当前账号已改变'}).waitFor();
 assert.equal(await form.getByLabel('仓位编号',{exact:true}).inputValue(),'OLD-DRAFT');assert.equal((await pool.query('SELECT count(*) FROM stock_locations')).rows[0].count,'0');
 }finally{await browser.close();}});
}));
