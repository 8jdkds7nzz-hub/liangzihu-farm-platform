import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {withDb} from '../support/db';import {actorFixture,objectFixture,permit} from '../support/fixtures';import {releaseTestLot} from '../support/stock';import {transaction} from '../../src/db/pool';
import {createLot,createLocation} from '../../src/modules/inventory/catalog';import {postMovement} from '../../src/modules/inventory/ledger';import {transformStock} from '../../src/modules/inventory/transforms';
import {traceLots,readTrace} from '../../src/modules/traceability/trace';import {draftCard,reviewCard,publicCard,publicContent} from '../../src/modules/traceability/public';
const key=()=>randomUUID(),now=()=>new Date().toISOString();
test('3B双向查询、专家边界不泄露、快照读取重核撤权',()=>withDb(async pool=>{
 const a=await actorFixture(pool,'technician'),o=await objectFixture(pool,a.id);await permit(pool,a.id,o,['read','record','review','share']);
 const tx=(fn:any)=>transaction<any>(fn,pool),l:any[]=[];
 for(const name of ['A','B','C'])l.push(await tx((c:any)=>createLot(c,a,{objectId:o,code:name,product:'合成'+name,kind:name==='A'?'harvest':'processed',unit:'kg',basis:'as_is',source:'测试',requestKey:key()})));
 const w=await tx((c:any)=>createLocation(c,a,{objectId:o,code:'W',name:'合成仓',requestKey:key()}));
 await tx((c:any)=>postMovement(c,a,{objectId:o,lotId:l[0].id,locationId:w.id,kind:'receipt',quantity:'10',occurredAt:now(),evidence:'合成',requestKey:key()}));
 for(let i=0;i<2;i++){await releaseTestLot(pool,a,o,l[i].id);await tx((c:any)=>transformStock(c,a,{objectId:o,code:'T'+i,kind:'processing',inputs:[{lotId:l[i].id,locationId:w.id,quantity:'10'}],outputs:[{lotId:l[i+1].id,locationId:w.id,quantity:'10'}],occurredAt:now(),evidence:'合成',requestKey:key()}));}
 const forward=await tx((c:any)=>traceLots(c,a,{lotId:l[0].id,direction:'forward',requestKey:key()})),back=await tx((c:any)=>traceLots(c,a,{lotId:l[2].id,direction:'backward',requestKey:key()}));
 assert.deepEqual(forward.snapshot.nodes.map((n:any)=>n.code).sort(),['A','B','C']);assert.equal(back.snapshot.edges.length,2);
 const expert=await actorFixture(pool,'expert');await permit(pool,expert.id,o,['read']);
 await pool.query("INSERT INTO resource_grants(user_id,object_id,resource_type,resource_id,expires_at,created_by) VALUES($1,$2,'stock_lot',$3,now()+interval '1 day',$4)",[expert.id,o,l[0].id,a.id]);
 const limited=await tx((c:any)=>traceLots(c,expert,{lotId:l[0].id,direction:'forward',requestKey:key()}));
 assert.equal(limited.snapshot.boundary,true);assert.equal(JSON.stringify(limited.snapshot).includes(l[1].id),false);
 await pool.query('UPDATE grants SET revoked_at=now() WHERE user_id=$1',[a.id]);await assert.rejects(()=>tx((c:any)=>readTrace(c,a,forward.id)),{status:403});
}));
test('3B客户页白名单、独立审核、实时质量限制及撤回',()=>withDb(async pool=>{
 const a=await actorFixture(pool,'technician'),o=await objectFixture(pool,a.id);await permit(pool,a.id,o,['read','record','review','share']);
 const tx=(fn:any)=>transaction<any>(fn,pool),l=await tx((c:any)=>createLot(c,a,{objectId:o,code:key(),product:'合成稻米',kind:'processed',unit:'kg',basis:'as_is',source:'测试',requestKey:key()})),approved=await releaseTestLot(pool,a,o,l.id);
 const content={productName:'合成稻米',batchLabel:'公开批次样例',province:'湖北省',city:'鄂州市',county:'梁子湖区',harvestMonth:'2026-10',productionSummary:'软件测试信息',testSummary:'工程合成报告，不能用于实物质量证明',limitations:'批次级，非实物认证'};
 assert.throws(()=>publicContent({...content,objectId:o}),{code:'PUBLIC_FIELDS'});
 assert.throws(()=>publicContent({...content,productionSummary:o}),{code:'PUBLIC_PRIVATE_DATA'});
 const card=await tx((c:any)=>draftCard(c,a,{lotId:l.id,content,credentialIds:[],validUntil:new Date(Date.now()+86400000).toISOString(),requestKey:key()}));
 await assert.rejects(()=>tx((c:any)=>publicCard(c,card.code)),{status:404});
 await assert.rejects(()=>tx((c:any)=>reviewCard(c,a,{id:card.id,action:'approve',evidence:'测试',requestKey:key()})),{code:'INDEPENDENT_REVIEW'});
 await tx((c:any)=>reviewCard(c,approved.reviewer,{id:card.id,action:'approve',evidence:'独立合成审核',requestKey:key()}));
 const publicResult=await tx((c:any)=>publicCard(c,card.code));assert.equal(JSON.stringify(publicResult).includes(l.id),false);assert.equal(JSON.stringify(publicResult).includes(o),false);
 await tx((c:any)=>reviewCard(c,approved.reviewer,{id:card.id,action:'revoke',evidence:'合成撤回',requestKey:key()}));await assert.rejects(()=>tx((c:any)=>publicCard(c,card.code)),{status:404});
}));

