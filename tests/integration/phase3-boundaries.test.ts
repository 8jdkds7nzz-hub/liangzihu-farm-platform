import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {withDb} from '../support/db';import {actorFixture,objectFixture,permit} from '../support/fixtures';import {syntheticAsset} from '../support/agronomy';import {transaction} from '../../src/db/pool';import {AppError} from '../../src/platform/error';import {localStore} from '../../src/modules/media/storage';import {queueSpectral,runSpectral} from '../../src/modules/agronomy/spectral';import {recoverAgronomy} from '../../src/modules/agronomy/common';
import {createLot} from '../../src/modules/inventory/catalog';import {createProtectionPlan,protectionPlan} from '../../src/modules/protection/plans';import {createPrescription,prescription} from '../../src/modules/protection/prescriptions';import {shareResource,revokeResource} from '../../src/modules/field/shares';
const key=()=>randomUUID(),future=()=>new Date(Date.now()+86400000).toISOString();
test('3C派生成果写入失败不伪装持续运行，恢复状态后新版本可重算',{timeout:120000},()=>withDb(async pool=>{
 const dir=await mkdtemp(join(tmpdir(),'spectral-failure-'));try{
 const store=localStore(join(dir,'source'),join(dir,'backup')),a=await actorFixture(pool,'technician'),o=await objectFixture(pool,a.id);await permit(pool,a.id,o,['read','record']);const tif=await syntheticAsset(pool,a,o,store,'spectral');
 const b={assetId:tif.id,rawAssetIds:[],capturedAt:new Date().toISOString(),sourceRef:'仅合成',processor:'合成v1',indexKind:'NDVI',bands:{red:0,nir:1},calibration:{state:'reflectance',scale:1,offset:0,evidence:'已知像素'},breaks:[],requestKey:key()};
 const first=await transaction(c=>queueSpectral(c,a,b),pool);await assert.rejects(()=>runSpectral(pool,first.id,undefined,{...store,put:async()=>{throw new AppError(503,'TEST_STORE_DOWN','合成写入故障');}}),{code:'TEST_STORE_DOWN'});
 await recoverAgronomy(pool);assert.equal((await pool.query('SELECT state FROM spectral_products WHERE id=$1',[first.id])).rows[0].state,'failed');assert.equal((await pool.query('SELECT count(*) FROM media_assets')).rows[0].count,'1');
 const second=await transaction(c=>queueSpectral(c,a,{...b,requestKey:key()}),pool);await runSpectral(pool,second.id,undefined,store);const row=(await pool.query('SELECT * FROM spectral_products WHERE id=$1',[second.id])).rows[0];assert.equal(row.version,2);assert.equal(row.state,'complete');
 await runSpectral(pool,second.id,undefined,store);assert.equal((await pool.query('SELECT count(*) FROM media_assets')).rows[0].count,'3');
 }finally{await rm(dir,{recursive:true,force:true});}
}));
test('3C专家计划授权不扩大到处方，固定处方版本与撤权分别核验',()=>withDb(async pool=>{
 const a=await actorFixture(pool,'technician'),expert=await actorFixture(pool,'expert'),o=await objectFixture(pool,a.id);await permit(pool,a.id,o,['read','record','review','share']);await permit(pool,expert.id,o,['read']);
 const tx=(fn:any)=>transaction<any>(fn,pool),lot=await tx((c:any)=>createLot(c,a,{objectId:o,code:key(),product:'合成材料',kind:'input',unit:'L',basis:'as_is',source:'仅测试',requestKey:key()})),boundary={type:'Polygon',coordinates:[[[114,30],[114.001,30],[114.001,30.001],[114,30.001],[114,30]]]};
 const plan=await tx((c:any)=>createProtectionPlan(c,a,{objectId:o,title:'固定版本',crop:'合成',target:'测试',stage:'测试',boundary,obstacles:'未知',sensitiveAreas:[],sensitiveNote:'待核',conditions:'非现场',inputLotId:lot.id,source:'合成',requestKey:key()}));
 const b={planId:plan.id,zones:[{name:'测试',rate:'0',geometry:boundary}],doseUnit:'L/亩',basis:'非农艺建议',requestKey:key()},map=await tx((c:any)=>createPrescription(c,a,b));
 await tx((c:any)=>shareResource(c,a,{objectId:o,recipientId:expert.id,resourceType:'protection_plan',resourceId:plan.id,expiresAt:future()}));await tx((c:any)=>protectionPlan(c,expert,plan.id));await assert.rejects(()=>tx((c:any)=>prescription(c,expert,map.id)),{status:403});
 const grant=await tx((c:any)=>shareResource(c,a,{objectId:o,recipientId:expert.id,resourceType:'prescription_map',resourceId:map.id,expiresAt:future()}));await tx((c:any)=>prescription(c,expert,map.id));
 const newer=await tx((c:any)=>createPrescription(c,a,{...b,requestKey:key()}));await assert.rejects(()=>tx((c:any)=>prescription(c,expert,newer.id)),{status:403});await tx((c:any)=>revokeResource(c,a,{id:grant.id}));await assert.rejects(()=>tx((c:any)=>prescription(c,expert,map.id)),{status:403});
}));

