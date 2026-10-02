import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {withDb} from '../../tests/support/db';
import {actorFixture,objectFixture,permit} from '../../tests/support/fixtures';
import {transaction,database} from '../../src/db/pool';
import {createDocument,reviewDocument,indexDocument} from '../../src/modules/knowledge/service';
import {createBriefing,reviewItem,publishBriefing,readPublication} from '../../src/modules/briefings/service';
import {receiveCameraEvent,attachCameraImage} from '../../src/modules/cameras/service';
import {prepareMedia,uploadMedia} from '../../src/modules/media/service';
import {localStore,checksum} from '../../src/modules/media/storage';
import {queueReview,runImageReview,recordFieldSample,labelSample} from '../../src/modules/image-review/service';
import {requestAssistant,runAssistant} from '../../src/modules/assistant/service';
import {claimJob,recoverExpired} from '../../src/modules/jobs/repository';

// 仅从应用根目录执行；withDb强制agri_test及随机schema。禁止真实文字模型外发。
process.env.MODEL_EXTERNAL_ENABLED='0';
const cases:any[]=[];
await withDb(async pool=>{
  const tech=await actorFixture(pool,'technician'),owner=await actorFixture(pool,'owner'),worker=await actorFixture(pool,'worker'),objectId=await objectFixture(pool,tech.id);
  await permit(pool,tech.id,objectId,['read','configure','review','record','share']);
  await permit(pool,owner.id,objectId,['read']);await permit(pool,worker.id,objectId,['read']);
  const d=await transaction(c=>createDocument(c,tech,{objectIds:[objectId],title:'合成锁实验',body:'# 合成规程\n测试来源，仅用于软件核对。',version:'audit-v1',sourceRef:'synthetic-audit-'+randomUUID(),format:'markdown',evidenceNature:'非生产实验'}),pool);
  await transaction(c=>reviewDocument(c,tech,{id:d.id}),pool);
  let resume!:()=>void,started!:()=>void;
  const gate=new Promise<void>(r=>resume=r),entered=new Promise<void>(r=>started=r);
  const indexing=transaction(c=>indexDocument(c,d.id,async texts=>{started();await gate;return texts.map(()=>[1,...Array(511).fill(0)]);}),pool);
  await entered;
  let lockCode:string|null=null;
  try{await transaction(async c=>{await c.query("SET LOCAL lock_timeout='100ms'");return reviewDocument(c,tech,{id:d.id,withdraw:true});},pool);}catch(e:any){lockCode=e.code;}
  finally{resume();await indexing;}
  assert.equal(lockCode,'55P03');
  cases.push({id:'C-G03',method:'isolated_database_reproduction',confirmed:true,observation:'知识索引推理期间，撤回事务100ms锁等待超时',postgresCode:lockCode,localModelCalled:false});

  const b=await transaction(c=>createBriefing(c,tech,{objectIds:[objectId],period:'daily',from:'2026-10-01T00:00:00Z',to:'2026-10-02T00:00:00Z',requestKey:randomUUID()}),pool);
  const item=(await pool.query('SELECT id,version FROM briefing_items WHERE briefing_id=$1 ORDER BY id LIMIT 1',[b.id])).rows[0];
  await transaction(c=>reviewItem(c,tech,{id:item.id,version:item.version,decision:'adopted',reason:'合成审阅',requestKey:randomUUID()}),pool);
  const expiry=new Date(Date.now()+3600000).toISOString();
  const po=await transaction(c=>publishBriefing(c,tech,{briefingId:b.id,recipientId:owner.id,itemIds:[item.id],expiresAt:expiry,confirm:true,requestKey:randomUUID()}),pool);
  const pw=await transaction(c=>publishBriefing(c,tech,{briefingId:b.id,recipientId:worker.id,itemIds:[item.id],expiresAt:expiry,confirm:true,requestKey:randomUUID()}),pool);
  const so=await database(c=>readPublication(c,owner,po.id),pool),sw=await database(c=>readPublication(c,worker,pw.id),pool);
  assert.notEqual(so.roleVersion,sw.roleVersion);assert.deepEqual(so.items,sw.items);
  cases.push({id:'C-G07',method:'isolated_database_reproduction',confirmed:true,observation:'老板与工人版角色标签不同，但同事项发布内容完全相同',externalMessagesSent:0});

  const source=(await pool.query("INSERT INTO data_sources(object_id,code,name,provider,created_by) VALUES($1,'audit','合成源','synthetic',$2) RETURNING id",[objectId,tech.id])).rows[0];
  const device=(await pool.query("INSERT INTO devices(object_id,source_id,external_id,name,kind,source,verified,created_by) VALUES($1,$2,'audit','合成设备','physical','仅测试',true,$3) RETURNING id",[objectId,source.id,tech.id])).rows[0];
  const event=await transaction(c=>receiveCameraEvent(c,tech,{deviceId:device.id,externalEventId:'audit-event',contractVersion:'synthetic',occurredAt:'2026-10-01T01:00:00Z',eventType:'合成告警'}),pool);
  const dir=await mkdtemp(join(tmpdir(),'agri-design-audit-'));
  try{
    const store=localStore(join(dir,'source'),join(dir,'backup')),png=await sharp({create:{width:8,height:8,channels:3,background:'#888888'}}).png().toBuffer(),id=randomUUID();
    await transaction(c=>prepareMedia(c,tech,{objectId,assetId:id,requestKey:id,submissionId:event.id,checksum:checksum(png),byteLength:png.length,mime:'image/png',name:'合成.png',source:'非生产'}),pool);
    await transaction(c=>uploadMedia(c,tech,id,png,store),pool);await transaction(c=>attachCameraImage(c,tech,{id:event.id,assetId:id}),pool);
    const autoJobs=Number((await pool.query("SELECT count(*) FROM jobs WHERE kind='image.review'")).rows[0].count);
    assert.equal(autoJobs,0);cases.push({id:'C-G09',method:'isolated_database_reproduction',confirmed:true,observation:'图片入库并关联事件后，没有自动生成图片复核任务',imageReviewJobs:autoJobs});
    const r=await transaction(c=>queueReview(c,tech,{cameraEventId:event.id,requestKey:randomUUID()}),pool);
    await pool.query("UPDATE grants SET revoked_at=now() WHERE user_id=$1 AND action='record'",[tech.id]);
    let called=false;await runImageReview(pool,r.id,store,async()=>{called=true;return {detections:[]};});
    const state=(await pool.query('SELECT state FROM image_reviews WHERE id=$1',[r.id])).rows[0].state;
    assert.equal(called,true);assert.equal(state,'complete');
    cases.push({id:'C-G02',method:'isolated_database_reproduction',confirmed:true,observation:'提交者record权限撤回后，已排队图片复核仍读取原件并完成写回',imageInferenceStubCalled:called,state,externalModelCalled:false});
  }finally{await rm(dir,{recursive:true,force:true});}
  await pool.query("UPDATE grants SET revoked_at=NULL WHERE user_id=$1 AND action='record'",[tech.id]);
  const sampleInput={deviceId:device.id,scene:'day',sourceRef:'合成现场样本',occurredAt:'2026-10-01T01:00:00Z',target:'person',expectedTrigger:true,requestKey:randomUUID()};
  const sample=await transaction(c=>recordFieldSample(c,tech,sampleInput),pool);
  const changed=await transaction(c=>recordFieldSample(c,tech,{...sampleInput,target:'absent',expectedTrigger:false}),pool);
  assert.equal(changed.state,'already_recorded');
  await transaction(c=>labelSample(c,tech,{id:sample.id,humanLabel:'person'}),pool);
  const human=(await pool.query('SELECT created_by=labelled_by AS same FROM image_field_samples WHERE id=$1',[sample.id])).rows[0];assert.equal(human.same,true);
  cases.push({id:'C-G10',method:'isolated_database_reproduction',confirmed:true,observation:'同样本标识异内容未报冲突；创建者可标注自己的样本',changedResponse:changed.state,sameCreatorAndLabeler:human.same});

  const run=await transaction(c=>requestAssistant(c,tech,{objectIds:[objectId],question:'合成锁实验中的测试来源是什么？',requestKey:randomUUID()}),pool);
  const job=await claimJob(pool,'synthetic-old-executor',new Date(),{kinds:['assistant.generate'],leaseMs:1000});assert(job);
  await pool.query("UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[job.id]);await recoverExpired(pool,new Date());
  await runAssistant(pool,run.id);
  const saved=(await pool.query('SELECT state FROM assistant_runs WHERE id=$1',[run.id])).rows[0].state;
  const jobState=(await pool.query('SELECT state FROM jobs WHERE id=$1',[job.id])).rows[0].state;
  assert.equal(saved,'program_only');assert.equal(jobState,'retry_wait');
  cases.push({id:'C-G01',method:'isolated_database_reproduction',confirmed:true,observation:'助手任务租约已过期回收，旧处理函数仍能写入业务结果',assistantState:saved,jobState,externalModelCalled:false});
});
const result={checkedAt:new Date().toISOString(),baselineCommit:'d26720bd5a19af7184c9c0a8a53307bfad077ac5',kind:'post_implementation_audit',database:'agri_test',isolation:'random schema dropped in finally',productionDataWritten:false,actualVendorCalls:false,externalMessagesSent:false,cases,limits:['为发现缺口而执行的合成复现，不是产品验收通过','图片推理与知识索引使用受控函数替身；助手允许现有本地向量进程，但未调用真实文字模型','本轮未修复被复现的问题']};
await writeFile('docs/acceptance/一期1b与1c详细核对实测.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({cases:cases.length,confirmed:cases.every(c=>c.confirmed),productionDataWritten:false}));
