import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {withDb} from '../support/db';import {actorFixture,objectFixture,permit} from '../support/fixtures';import {transaction} from '../../src/db/pool';import {createLot} from '../../src/modules/inventory/catalog';
import {createProtectionPlan} from '../../src/modules/protection/plans';import {createPrescription,reviewPrescription,prescriptionEvent} from '../../src/modules/protection/prescriptions';import {recordExecution} from '../../src/modules/protection/executions';import {importExecutions} from '../../src/modules/protection/imports';
const key=()=>randomUUID(),boundary={type:'Polygon',coordinates:[[[114,30],[114.001,30],[114.001,30.001],[114,30.001],[114,30]]]};
test('3C处方专业审核、最多五层、作业覆盖与逐行离线幂等',()=>withDb(async pool=>{
 const a=await actorFixture(pool,'technician'),reviewer=await actorFixture(pool,'technician'),o=await objectFixture(pool,a.id);for(const u of [a,reviewer])await permit(pool,u.id,o,['read','record','review','share']);
 const tx=(fn:any)=>transaction<any>(fn,pool),l=await tx((c:any)=>createLot(c,a,{objectId:o,code:key(),product:'合成材料',kind:'input',unit:'L',basis:'as_is',source:'软件测试',requestKey:key()}));
 const p=await tx((c:any)=>createProtectionPlan(c,a,{objectId:o,title:'合成植保',crop:'水稻',target:'工程记录测试',stage:'现场阶段待验',boundary,obstacles:'合成空场，非真实资料',sensitiveAreas:[],sensitiveNote:'仅测试，无现场判断',conditions:'仅工程验证',inputLotId:l.id,source:'合成',requestKey:key()}));
 const b={planId:p.id,zones:[{name:'测试分区',rate:'0',geometry:boundary}],doseUnit:'L/亩',basis:'合成零剂量，不是农艺建议',requestKey:key()};
 await assert.rejects(()=>tx((c:any)=>createPrescription(c,a,{...b,zones:Array(6).fill(b.zones[0])})),{code:'PRESCRIPTION_ZONES'});
 const map=await tx((c:any)=>createPrescription(c,a,b));await assert.rejects(()=>tx((c:any)=>reviewPrescription(c,a,{id:map.id,action:'approve',evidence:'测试',requestKey:key()})),{code:'PRESCRIPTION_REVIEW'});
 await tx((c:any)=>reviewPrescription(c,reviewer,{id:map.id,action:'approve',evidence:'独立软件审核',requestKey:key()}));
 const start=new Date(Date.now()+1000).toISOString(),end=new Date(Date.now()+11000).toISOString();
 const execution={planId:p.id,prescriptionId:map.id,operator:'合成操作者',startedAt:start,endedAt:end,unit:'L',materialQuantity:null,track:[{time:start,longitude:114.0002,latitude:30.0005,spraying:true,flow:1},{time:end,longitude:114.0008,latitude:30.0005,spraying:true,flow:1}],swathM:5,maxGapSeconds:30,evidence:'合成未来轨迹，仅测试',requestKey:key()};
 const e=await tx((c:any)=>recordExecution(c,a,execution));assert(e.coverage.coveredM2>0);assert(e.coverage.missedM2>0);assert.equal(e.material_quantity,null);
 await tx((c:any)=>prescriptionEvent(c,a,{prescriptionId:map.id,action:'applied',executionId:e.id,party:'合成确认',occurredAt:end,evidence:'测试',requestKey:key()}));
 const raw={objectId:o,sourceRef:'合成离线',rows:[{...execution,externalId:'OFF1'}, {...execution,externalId:'OFF2',unit:'kg'}],requestKey:key()};
 const result=await tx((c:any)=>importExecutions(c,a,raw));assert.deepEqual(result.rows.map((r:any)=>r.ok),[true,false]);
 const again=await tx((c:any)=>importExecutions(c,a,{...raw,requestKey:key()}));assert.equal(again.rows[0].id,result.rows[0].id);assert.equal((await pool.query('SELECT count(*) FROM protection_executions')).rows[0].count,'2');
}));

