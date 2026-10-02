import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Pool} from 'pg';
import sharp from 'sharp';
import {withDb} from '../support/db';
import {actorFixture,objectFixture,permit} from '../support/fixtures';
import {transaction} from '../../src/db/pool';
import {AppError} from '../../src/platform/error';
import {claimJob,recoverExpired} from '../../src/modules/jobs/repository';
import {createDocument,reviewDocument,indexDocument} from '../../src/modules/knowledge/service';
import {requestAssistant,runAssistant,saveModelPolicy} from '../../src/modules/assistant/service';
import {receiveCameraEvent,attachCameraImage} from '../../src/modules/cameras/service';
import {prepareMedia,uploadMedia} from '../../src/modules/media/service';
import {localStore,checksum} from '../../src/modules/media/storage';
import {queueReview,runImageReview} from '../../src/modules/image-review/service';
import {confirmModelReceipt} from '../../src/modules/assistant/receipts';

const vectors=async(texts:string[])=>texts.map(()=>[1,...Array(511).fill(0)]);
async function fixture(pool:Pool){
 const tech=await actorFixture(pool,'technician'),objectId=await objectFixture(pool,tech.id);
 await permit(pool,tech.id,objectId,['read','record','review','configure']);
 const doc=await transaction(c=>createDocument(c,tech,{objectIds:[objectId],title:'合成水质规程',version:'test-v1',sourceRef:randomUUID(),body:'# 水质\n溶解氧缺测先人工核查，不能判断正常。',format:'markdown',evidenceNature:'合成工程测试'}),pool);
 await transaction(c=>reviewDocument(c,tech,{id:doc.id}),pool);
 const ask=()=>transaction(c=>requestAssistant(c,tech,{objectIds:[objectId],question:'溶解氧核查',requestKey:randomUUID()}),pool);
 const policy=(allowBackup=true,price=1000)=>transaction(c=>saveModelPolicy(c,tech,{objectId,maxMonthTokens:1000000,maxMonthCalls:100,externalEnabled:true,allowBackup,inputPricePerMillion:price,outputPricePerMillion:price,priceSource:'合成单价',approvedScope:'仅受控provider测试，不是真实外发'}),pool);
 return {tech,objectId,doc,ask,policy};
}
test('T01助手旧租约不能执行或写回；回收后新租约可完成',()=>withDb(async pool=>{
 const f=await fixture(pool),run=await f.ask(),lease=await claimJob(pool,'old',new Date(),{kinds:['assistant.generate']});assert(lease);
 await pool.query("UPDATE jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[lease.id]);
 await assert.rejects(()=>Reflect.apply(runAssistant,null,[pool,run.id,undefined,vectors,lease]),{code:'LEASE_LOST'});
 assert.equal((await pool.query('SELECT result FROM assistant_runs WHERE id=$1',[run.id])).rows[0].result,null);
 await recoverExpired(pool);await runAssistant(pool,run.id,undefined,vectors);
 assert.equal((await pool.query('SELECT state FROM assistant_runs WHERE id=$1',[run.id])).rows[0].state,'program_only');
}));
test('T01推理期间旧租约失效，迟到答案不落库；已外发中断持久待核',()=>withDb(async pool=>{
 const f=await fixture(pool);await f.policy();const run=await f.ask(),lease=await claimJob(pool,'old',new Date(),{kinds:['assistant.generate']});assert(lease);
 await assert.rejects(()=>Reflect.apply(runAssistant,null,[pool,run.id,async(ctx:any)=>{
  await pool.query("UPDATE jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[lease.id]);await recoverExpired(pool);
  return {output:{claims:[{text:'先人工核查',evidenceIds:[ctx.evidence[0].chunkId],metricIds:[],limitations:[]}]},model:'test',usage:{inputTokens:10,outputTokens:10},truncated:false};
 },vectors,lease]),{code:'LEASE_LOST'});
 assert.equal((await pool.query('SELECT result FROM assistant_runs WHERE id=$1',[run.id])).rows[0].result,null);
 await assert.rejects(()=>runAssistant(pool,run.id,undefined,vectors),{code:'RESULT_UNKNOWN'});
 assert.equal((await pool.query('SELECT state FROM assistant_runs WHERE id=$1',[run.id])).rows[0].state,'result_unknown');
 const bill={runId:run.id,confirm:true,costs:[{objectId:f.objectId,amountCny:.01,inputTokens:10,outputTokens:0,calls:1}],evidence:'仅测试回执，主调用计费已人工核对'};
 await transaction(c=>confirmModelReceipt(c,f.tech,bill),pool);await transaction(c=>confirmModelReceipt(c,f.tech,bill),pool);
 assert.equal((await pool.query('SELECT state FROM assistant_runs WHERE id=$1',[run.id])).rows[0].state,'resolved_without_answer');
 await assert.rejects(()=>transaction(c=>confirmModelReceipt(c,f.tech,{...bill,evidence:'不同账单'}),pool),{code:'REQUEST_KEY_CONFLICT'});
}));
test('T02撤回不等待索引推理；撤回后迟到向量不写入',()=>withDb(async pool=>{
 const f=await fixture(pool);let resume!:()=>void,entered!:()=>void;
 const gate=new Promise<void>(r=>resume=r),start=new Promise<void>(r=>entered=r);
 const indexing=Reflect.apply(indexDocument,null,[pool,f.doc.id,async(texts:string[])=>{entered();await gate;return vectors(texts);}]);await start;
 try{await transaction(async c=>{await c.query("SET LOCAL lock_timeout='100ms'");await reviewDocument(c,f.tech,{id:f.doc.id,withdraw:true});},pool);}finally{resume();}
 await indexing;assert.equal((await pool.query('SELECT count(*) FROM knowledge_chunks WHERE document_id=$1 AND embedding IS NOT NULL',[f.doc.id])).rows[0].count,'0');
}));
test('T03备用调用前刷新许可；结算使用调用时价格',()=>withDb(async pool=>{
 const f=await fixture(pool);await f.policy();const run=await f.ask();let backup=0;
 await runAssistant(pool,run.id,async(ctx,isBackup)=>{if(!isBackup){await f.policy(false);throw new AppError(503,'MODEL_HTTP_FAILED','合成拒绝');}backup++;return {output:{},model:'test',usage:null,truncated:false};},vectors);
 assert.equal(backup,0);
 await f.policy(true,1000);const priced=await f.ask();await runAssistant(pool,priced.id,async(ctx)=>{await f.policy(true,100000);return {output:{claims:[{text:'先人工核查',evidenceIds:[(ctx.evidence as any[])[0].chunkId],metricIds:[],limitations:[]}]},model:'test',usage:{inputTokens:10,outputTokens:10},truncated:false};},vectors);
 assert.equal(Number((await pool.query("SELECT amount FROM usage_events WHERE business_key=$1",['model-run:'+priced.id+':'+f.objectId])).rows[0].amount),.02);
}));
test('T01图片排队后撤权不读取私有原件/不推理',()=>withDb(async pool=>{
 const f=await fixture(pool),source=(await pool.query("INSERT INTO data_sources(object_id,code,name,provider,created_by) VALUES($1,'test','合成源','synthetic',$2) RETURNING id",[f.objectId,f.tech.id])).rows[0],device=(await pool.query("INSERT INTO devices(object_id,source_id,external_id,name,kind,source,verified,created_by) VALUES($1,$2,'test','合成设备','physical','测试',true,$3) RETURNING id",[f.objectId,source.id,f.tech.id])).rows[0],event=await transaction(c=>receiveCameraEvent(c,f.tech,{deviceId:device.id,externalEventId:'test',contractVersion:'synthetic',occurredAt:new Date().toISOString(),eventType:'测试'}),pool),dir=await mkdtemp(join(tmpdir(),'agri-runtime-'));
 try{const store=localStore(join(dir,'source'),join(dir,'backup')),png=await sharp({create:{width:8,height:8,channels:3,background:'#888888'}}).png().toBuffer(),id=randomUUID();await transaction(c=>prepareMedia(c,f.tech,{objectId:f.objectId,assetId:id,requestKey:id,submissionId:event.id,checksum:checksum(png),byteLength:png.length,mime:'image/png',name:'测试.png',source:'非生产'}),pool);await transaction(c=>uploadMedia(c,f.tech,id,png,store),pool);await transaction(c=>attachCameraImage(c,f.tech,{id:event.id,assetId:id}),pool);const review=await transaction(c=>queueReview(c,f.tech,{cameraEventId:event.id,requestKey:randomUUID()}),pool);await pool.query("UPDATE grants SET revoked_at=now() WHERE user_id=$1 AND action='record'",[f.tech.id]);let reads=0,detected=0;
 await runImageReview(pool,review.id,{...store,get:async key=>{reads++;return store.get(key);}},async()=>{detected++;return {detections:[]};});assert.equal(reads,0);assert.equal(detected,0);assert.equal((await pool.query('SELECT state FROM image_reviews WHERE id=$1',[review.id])).rows[0].state,'access_revoked');
 }finally{await rm(dir,{recursive:true,force:true});}
}));
