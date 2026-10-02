import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {transaction,database} from '../src/db/pool';
import type {telemetryFixture} from '../tests/support/telemetry';
import type {seedRecovery} from './recovery-fixture';
import {checksum,streamChecksum} from '../src/modules/media/storage';
import {createUpload,uploadPart,completeUpload,assembleUpload,backupMedia,streamMedia,UPLOAD_CHUNK_BYTES} from '../src/modules/media/uploads';
import {saveBoundary} from '../src/modules/map/service';
import {importFlight,linkFlightAsset,annotateFlight} from '../src/modules/flights/service';
import {saveCoverage,queueRaster,runRaster} from '../src/modules/flights/spatial';
import {saveDefinition,reviewDefinition} from '../src/modules/analysis/service';
import {saveSchedule,generateDue,runCalculation,runScheduledBriefing} from '../src/modules/briefings/schedule';
import {reviewItem,publishBriefing,revokePublication,readPublication} from '../src/modules/briefings/service';
import {requestAssistant,runAssistant,saveModelPolicy} from '../src/modules/assistant/service';
import {confirmModelReceipt} from '../src/modules/assistant/receipts';
import {actorFixture,permit} from '../tests/support/fixtures';
import {createRecovery} from '../src/modules/identity/recovery';
import {AppError} from '../src/platform/error';
import {reconcileExecutions} from '../src/modules/jobs/execution';
import {saveSource,saveDevice} from '../src/modules/registry/devices';
import {saveCameraCapabilities,requestCameraRead,runCameraRead,proxyCameraStream} from '../src/modules/cameras/readonly';
import {receiveCameraEvent,attachCameraImage} from '../src/modules/cameras/service';
import {bindExpertPhone,requestExpertSms,verifyExpertSms} from '../src/modules/identity/sms';
import {saveComparison,reviewComparison,calculateComparison} from '../src/modules/analysis/comparisons';

export async function seedPhase1Recovery(pool:Pool,f:Awaited<ReturnType<typeof telemetryFixture>>,field:Awaited<ReturnType<typeof seedRecovery>>,encryptionKey:string){
 const {actor:a,objectId}=f,store=field.store;
 await permit(pool,a.id,objectId,['share','dispatch']);
 const large=Buffer.alloc(21*1024*1024,32);large.write('%PDF-1.7');
 const upload=await transaction(c=>createUpload(c,a,{objectId,requestKey:randomUUID(),name:'合成恢复大原件.pdf',mime:'application/pdf',byteLength:large.length,checksum:checksum(large),source:'21MiB合成恢复数据，不是农场原件'}),pool);
 for(let offset=0,index=0;offset<large.length;offset+=UPLOAD_CHUNK_BYTES,index++)await uploadPart(pool,a,upload.id,index,large.subarray(offset,Math.min(large.length,offset+UPLOAD_CHUNK_BYTES)),store);
 await transaction(c=>completeUpload(c,a,{id:upload.id}),pool);await assembleUpload(pool,upload.id,undefined,store);await backupMedia(pool,upload.assetId,undefined,store);
 const geometry={type:'Polygon',coordinates:[[[114,30],[114.01,30],[114.01,30.01],[114,30.01],[114,30]]]};
 await transaction(c=>saveBoundary(c,a,{objectId,version:1,sourceCrs:4326,status:'verified',source:'合成坐标，不是现场图纸',geometry}),pool);
 const flight=await transaction(c=>importFlight(c,a,{objectId,sourceId:f.source.id,externalId:'synthetic-restore-flight',startedAt:'2026-10-01T00:00:00Z',finishedAt:'2026-10-01T00:10:00Z',aircraftModel:'合成机型',providerVersion:'synthetic',sourceRef:'合成恢复关系',crs:'EPSG:4326合成',files:[{externalId:'original',name:'合成原片.png',version:'1',kind:'original',checksum:field.checksum},{externalId:'ortho',name:'合成正射.png',version:'1',kind:'orthophoto',checksum:field.checksum,parents:['original'],processingSource:'合成成果，非农业配准验证'}]}),pool);
 const file=(await pool.query("SELECT id FROM flight_files WHERE flight_id=$1 AND kind='orthophoto'",[flight.id])).rows[0];
 await transaction(c=>linkFlightAsset(c,a,{fileId:file.id,assetId:field.assetId}),pool);
 await transaction(c=>saveCoverage(c,a,{flightId:flight.id,status:'verified',sourceCrs:4326,geometry,sourceRef:'合成覆盖',requestKey:randomUUID()}),pool);
 const raster=await transaction(c=>queueRaster(c,a,{fileId:file.id,sourceCrs:4326,bounds:[114,30,114.01,30.01],sourceRef:'合成北向配准',confirm:true,requestKey:randomUUID()}),pool);
 await runRaster(pool,raster.id,undefined,store);
 const preview=(await pool.query('SELECT preview_asset_id FROM flight_rasters WHERE id=$1',[raster.id])).rows[0].preview_asset_id;
 await backupMedia(pool,preview,undefined,store);
 await transaction(c=>annotateFlight(c,a,{flightId:flight.id,fileId:file.id,note:'合成疑点',location:{type:'image',x:.5,y:.5},sourceRef:'合成原片中点',requestKey:randomUUID()}),pool);
 const def=await transaction(c=>saveDefinition(c,a,{objectId,pointId:f.point.id,name:'合成恢复均值',sourceRef:'非生产阈值',specification:{formula:'mean',inputUnit:'test_unit',unit:'test_unit',intervalMs:60000,maxGapMs:120000,minimumCoverage:.8,timezone:'UTC'}}),pool);
 await transaction(c=>reviewDefinition(c,a,{id:def.id}),pool);
 await transaction(c=>saveSchedule(c,a,{objectId,period:'daily',hour:0,minute:0,enabled:true,evidence:'合成调度恢复'}),pool);
 const generated=await generateDue(pool,new Date('2026-10-02T02:00:00Z'));
 for(const r of (await pool.query('SELECT id FROM analysis_calculations')).rows)await runCalculation(pool,r.id);
 for(const id of generated)await runScheduledBriefing(pool,id);
 const briefing=(await pool.query('SELECT id FROM briefings LIMIT 1')).rows[0];
 const items=(await pool.query('SELECT * FROM briefing_items WHERE briefing_id=$1',[briefing.id])).rows;
 for(const i of items)await transaction(c=>reviewItem(c,a,{id:i.id,version:i.version,decision:'adopted',reason:'合成工程核对，缺口保留',requestKey:randomUUID()}),pool);
 const owner=await actorFixture(pool,'owner');await permit(pool,owner.id,objectId,['read']);
 const publication=await transaction(c=>publishBriefing(c,a,{briefingId:briefing.id,recipientId:owner.id,itemIds:items.map(i=>i.id),confirm:true,expiresAt:new Date(Date.now()+3600000).toISOString(),requestKey:randomUUID()}),pool);
 await transaction(c=>revokePublication(c,a,{id:publication.id,reason:'合成恢复撤回验证'}),pool);
 await transaction(c=>saveModelPolicy(c,a,{objectId,maxMonthTokens:1000000,maxMonthCalls:10,externalEnabled:true,allowBackup:false,inputPricePerMillion:1,outputPricePerMillion:1,priceSource:'合成测试价格，不是报价',approvedScope:'隔离库provider替身，不联系模型'}),pool);
 const run=await transaction(c=>requestAssistant(c,a,{objectIds:[objectId],question:'溶解氧先人工核查',requestKey:randomUUID()}),pool);
 await runAssistant(pool,run.id,async()=>{throw new AppError(503,'MODEL_TIMEOUT','合成中断');},async()=>[]);
 await transaction(c=>confirmModelReceipt(c,a,{runId:run.id,confirm:true,evidence:'合成账单，不是真实供应商回执',costs:[{objectId,amountCny:0,inputTokens:0,outputTokens:0,calls:1}]}),pool);
 const pending=await transaction(c=>requestAssistant(c,a,{objectIds:[objectId],question:'溶解氧中断待核',requestKey:randomUUID()}),pool);
 await runAssistant(pool,pending.id,async()=>{throw new AppError(503,'MODEL_TIMEOUT','合成中断待核');},async()=>[]);
 const admin=await actorFixture(pool,'admin');await transaction(c=>createRecovery(c,owner.id,admin.id,{identityEvidence:'合成身份核验编号',reason:'合成恢复原理，不交付真实代码'}),pool);
 const camera=await transaction(async c=>{const source=await saveSource(c,a,{objectId,code:'SYNTH-RECOVERY-CAMERA',name:'合成监控来源',provider:'ezviz'});await c.query("UPDATE data_sources SET verified=true,contract_ref='合成只读契约' WHERE id=$1",[source.id]);const device=await saveDevice(c,a,{objectId,sourceId:source.id,externalId:'RESTORECAM',name:'合成摄像头',kind:'physical',serialNumber:'RESTORECAM',source:'仅隔离恢复'});await c.query("UPDATE devices SET verified=true,serial_number='RESTORECAM' WHERE id=$1",[device.id]);await saveCameraCapabilities(c,a,{deviceId:device.id,model:'合成型号',firmware:'synthetic',contractVersion:'synthetic',evidence:'仅工程恢复，不是G07签认',secretRef:'EZVIZ_ACCESS_TOKEN_RESTORE',channel:1,limitMonthCalls:10,live:true,readOnlyConfirmed:true,verified:true});return device;},pool);
 const cameraEnv={NODE_ENV:'test' as const,CAMERA_READS_ENABLED:'1',EZVIZ_ACCESS_TOKEN_RESTORE:'synthetic-token',MEDIA_IMPORT_ALLOWED_HOSTS:'media.example.com',IDENTITY_ENCRYPTION_KEY:encryptionKey},cameraRead=await transaction(c=>requestCameraRead(c,a,{deviceId:camera.id,operation:'live',requestKey:randomUUID()}),pool);
 await runCameraRead(pool,cameraRead.id,{env:cameraEnv,fetcher:(async()=>Response.json({code:'200',data:{url:'https://media.example.com/synthetic.m3u8?signature=SYNTHETIC'}})) as typeof fetch});
 await proxyCameraStream(pool,a,cameraRead.id,null,{env:cameraEnv,downloader:async()=>Buffer.from('#EXTM3U\n#EXTINF:2,\nsynthetic.ts\n')});
 const event=await transaction(c=>receiveCameraEvent(c,a,{deviceId:camera.id,externalEventId:'synthetic-restore-event',contractVersion:'synthetic',occurredAt:'2026-10-01T01:00:00Z',eventType:'synthetic_person'}),pool);
 await transaction(c=>attachCameraImage(c,a,{id:event.id,assetId:field.assetId}),pool);
 const expert=await actorFixture(pool,'expert'),oldKey=process.env.IDENTITY_ENCRYPTION_KEY;let smsCode='',sms;
 try{process.env.IDENTITY_ENCRYPTION_KEY=encryptionKey;await transaction(c=>bindExpertPhone(c,admin,{userId:expert.id,phone:'13800000001',confirmIdentity:true,evidence:'合成号码，没有真实发送'}),pool);sms=await requestExpertSms('13800000001',{async send(_phone,code){smsCode=code;return {accepted:true,requestId:'synthetic-receipt'};}},{pool,encryptionKey});}finally{if(oldKey===undefined)delete process.env.IDENTITY_ENCRYPTION_KEY;else process.env.IDENTITY_ENCRYPTION_KEY=oldKey;}
 const series=async(year:number,values:number[])=>{const start=year+'-01-01T00:00:00Z',d=(await pool.query("INSERT INTO metric_definitions(object_id,point_id,name,version,specification,source_ref,approved_by,approved_at,created_by) VALUES($1,$2,$3,1,$4,'合成数学恢复数据',$5,now(),$5) RETURNING id",[objectId,f.point.id,'合成'+year,JSON.stringify({formula:'gdd',inputUnit:'°C',unit:'°C·d',baseTemperature:0,capTemperature:40,timezone:'UTC',intervalMs:86400000,maxGapMs:86400000,minimumCoverage:1,species:'合成物种',variety:'合成品种',stage:'合成阶段',startDate:start}),a.id])).rows[0],ids:string[]=[];for(const [index,value]of values.entries()){const r=(await pool.query("INSERT INTO metric_results(object_id,definition_id,definition_version,window_start,window_end,value,unit,status,coverage,limitations,evidence_ids,input_hash,version) VALUES($1,$2,1,$3,$4,$5,'°C·d','usable',1,'[]','{}',$6,1) RETURNING id",[objectId,d.id,start,new Date(Date.parse(start)+(index+1)*86400000),value,String(index).padStart(64,'a')])).rows[0];ids.push(r.id);}return {id:d.id,ids};};
 const now=await series(2026,[2,4]),base=await series(2025,[1,2]),comparison=await transaction(c=>saveComparison(c,a,{objectId,name:'合成恢复条件差',currentDefinitionId:now.id,baselineDefinitionId:base.id,threshold:2,stationRef:'同一合成测点',anchorProtocol:'相同合成起算口径',varietyBasis:'same_verified',sourceRef:'仅数学恢复测试，不是物候结论'}),pool);
 await transaction(c=>reviewComparison(c,a,{id:comparison.id}),pool);await transaction(c=>calculateComparison(c,a,{definitionId:comparison.id,currentIds:now.ids,baselineIds:base.ids}),pool);
 return {largeAssetId:upload.assetId,largeChecksum:checksum(large),largeLength:large.length,previewAssetId:preview,rasterId:raster.id,publicationId:publication.id,owner,pendingRunId:pending.id,receiptRunId:run.id,cameraReadId:cameraRead.id,cameraEnv,sms:sms!,smsCode,encryptionKey};
}

export async function checkPhase1Recovery(pool:Pool,f:Awaited<ReturnType<typeof telemetryFixture>>,field:Awaited<ReturnType<typeof seedRecovery>>,seed:Awaited<ReturnType<typeof seedPhase1Recovery>>){
 const all=(await pool.query('SELECT id,storage_key,checksum,byte_length FROM media_assets')).rows;
 for(const row of all){const saved=await streamChecksum(await field.store.open!(row.storage_key,true));assert.equal(saved.checksum,row.checksum);assert.equal(saved.length,Number(row.byte_length));await field.store.putStream!(row.storage_key,await field.store.open!(row.storage_key,true),saved.length);}
 const stream=await streamMedia(pool,f.actor,seed.largeAssetId,null,field.store),result=await streamChecksum(stream.stream);assert.equal(result.checksum,seed.largeChecksum);assert.equal(result.length,seed.largeLength);
 await assert.rejects(()=>database(c=>readPublication(c,seed.owner,seed.publicationId),pool),{status:403});
 await reconcileExecutions(pool);assert.equal((await pool.query('SELECT state FROM assistant_runs WHERE id=$1',[seed.pendingRunId])).rows[0].state,'result_unknown');assert.equal((await pool.query('SELECT state FROM jobs WHERE business_key=$1',['assistant:'+seed.pendingRunId])).rows[0].state,'awaiting_receipt');
 assert.equal((await pool.query('SELECT state FROM assistant_runs WHERE id=$1',[seed.receiptRunId])).rows[0].state,'resolved_without_answer');
 const playlist=await proxyCameraStream(pool,f.actor,seed.cameraReadId,null,{env:seed.cameraEnv,downloader:async()=>Buffer.from('#EXTM3U\n#EXTINF:2,\nsynthetic.ts\n')});assert(!playlist.bytes.toString().includes('SYNTHETIC'));
 assert.equal((await verifyExpertSms(seed.sms.token,seed.sms.browserToken,seed.smsCode,{pool,encryptionKey:seed.encryptionKey})).kind,'session');
 const newTables=['media_upload_sessions','media_upload_parts','flight_coverages','flight_rasters','analysis_calculations','scheduled_briefings','model_attempts','model_receipts','identity_recoveries','camera_reads','camera_stream_resources','expert_phones','sms_challenges','comparison_definitions','comparison_results','image_review_requests'];
 const nonempty:Record<string,number>={};for(const table of newTables){const n=Number((await pool.query('SELECT count(*) FROM '+table)).rows[0].count);assert(n>0);nonempty[table]=n;}
 return {nonemptyTables:nonempty,allMediaCount:all.length,largeOriginalVerified:true,previewRestored:true,revokedPublicationDenied:true,unknownModelNotResent:true,confirmedBillNotRecreatedAsAnswer:true,privateCameraStreamRestored:true,expertSmsChallengeRestored:true};
}
