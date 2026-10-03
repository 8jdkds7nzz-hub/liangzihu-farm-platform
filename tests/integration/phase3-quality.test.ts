import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {withDb} from '../support/db';import {actorFixture,objectFixture,permit} from '../support/fixtures';import {transaction} from '../../src/db/pool';
import {createLot} from '../../src/modules/inventory/catalog';import {recordSample,recordTest,decideQuality,assertLotReleased} from '../../src/modules/traceability/quality';
import {openCase,caseEvent} from '../../src/modules/traceability/cases';
const key=()=>randomUUID(),now=()=>new Date().toISOString(),future=()=>new Date(Date.now()+86400000).toISOString();
test('3B检测与独立放行、失败报告立即阻断、版本冲突',()=>withDb(async pool=>{
 const a=await actorFixture(pool,'technician'),b=await actorFixture(pool,'technician'),o=await objectFixture(pool,a.id);for(const actor of [a,b])await permit(pool,actor.id,o,['read','record','review','share']);
 const tx=(fn:any)=>transaction<any>(fn,pool),l=await tx((c:any)=>createLot(c,a,{objectId:o,code:key(),product:'合成稻米',kind:'processed',unit:'kg',basis:'as_is',source:'测试',requestKey:key()}));
 const sample=await tx((c:any)=>recordSample(c,a,{lotId:l.id,sampleCode:key(),stage:'finished',sampledAt:now(),source:'合成取样',requestKey:key()}));
 const report=await tx((c:any)=>recordTest(c,a,{sampleId:sample.id,method:'合成检测方法',result:'pass',reportRef:'测试报告',testedAt:now(),validUntil:future(),requestKey:key()}));
 const decision={lotId:l.id,expectedVersion:1,toState:'available',testIds:[report.id],credentialIds:[],evidence:'软件审核测试',requestKey:key()};
 await assert.rejects(()=>tx((c:any)=>decideQuality(c,a,decision)),{code:'INDEPENDENT_REVIEW'});
 await tx((c:any)=>decideQuality(c,b,decision));await tx((c:any)=>assertLotReleased(c,l.id));
 await assert.rejects(()=>tx((c:any)=>decideQuality(c,b,{...decision,requestKey:key()})),{code:'QUALITY_VERSION'});
 await tx((c:any)=>recordTest(c,a,{sampleId:sample.id,method:'复查',result:'fail',reportRef:'合成失败',testedAt:now(),validUntil:future(),requestKey:key()}));
 await assert.rejects(()=>tx((c:any)=>assertLotReleased(c,l.id)),{code:'QUALITY_NOT_CURRENT'});
}));
test('3B问题通知、追回、处置各自留痕，不齐不能结案',()=>withDb(async pool=>{
 const a=await actorFixture(pool,'technician'),o=await objectFixture(pool,a.id);await permit(pool,a.id,o,['read','record','review']);
 const tx=(fn:any)=>transaction<any>(fn,pool),l=await tx((c:any)=>createLot(c,a,{objectId:o,code:key(),product:'合成',kind:'harvest',unit:'kg',basis:'as_is',source:'测试',requestKey:key()}));
 const problem=await tx((c:any)=>openCase(c,a,{lotId:l.id,title:'合成质量问题',targetQuantity:'10',evidence:'测试',requestKey:key()}));
 const event=(action:string,quantity?:string)=>tx((c:any)=>caseEvent(c,a,{caseId:problem.id,action,quantity,occurredAt:now(),evidence:'合成人工凭证',requestKey:key()}));
 await assert.rejects(()=>event('close'),{code:'CASE_INCOMPLETE'});await event('notice');await event('recover','10');
 await assert.rejects(()=>event('dispose','11'),{code:'CASE_QUANTITY'});await event('dispose','10');await event('close');
 assert.equal((await pool.query('SELECT state FROM quality_cases WHERE id=$1',[problem.id])).rows[0].state,'closed');
 assert.equal((await pool.query('SELECT state FROM stock_lots WHERE id=$1',[l.id])).rows[0].state,'pending');
}));

