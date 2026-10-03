import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {withDb} from '../support/db';import {actorFixture,objectFixture,permit} from '../support/fixtures';import {transaction} from '../../src/db/pool';
import {saveControlProfile,saveControlRule,reviewControlRule,requestControl,recordControlFeedback,recordTakeover} from '../../src/modules/control/records';
import {saveCameraCapabilities} from '../../src/modules/cameras/readonly';import {saveCropSchedule,scheduleCrops,toggleCropSchedule} from '../../src/modules/agronomy/schedules';import {syntheticAsset} from '../support/agronomy';import {localStore} from '../../src/modules/media/storage';
const key=()=>randomUUID(),now=()=>new Date().toISOString(),future=()=>new Date(Date.now()+86400000).toISOString();
async function fixture(pool:any){
 const a=await actorFixture(pool,'technician'),b=await actorFixture(pool,'technician'),objectId=await objectFixture(pool,a.id);for(const u of [a,b])await permit(pool,u.id,objectId,['read','record','review','configure','act']);
 const sourceId=key(),deviceId=key();await pool.query("INSERT INTO data_sources(id,object_id,code,name,provider,contract_ref,verified,created_by) VALUES($1::uuid,$2,$1::text,'合成只读来源','ezviz','合成接口契约',true,$3)",[sourceId,objectId,a.id]);
 await pool.query("INSERT INTO devices(id,object_id,source_id,external_id,name,kind,serial_number,source,verified,created_by) VALUES($1,$2,$3,'synthetic','仅测试设备','physical','test-serial','仅软件测试',true,$4)",[deviceId,objectId,sourceId,a.id]);return {a,b,objectId,deviceId};
}
test('3C控制准备三态与五层反馈独立，任何配置仍不下发，人工接管留痕',()=>withDb(async pool=>{
 const f=await fixture(pool),tx=(fn:any)=>transaction<any>(fn,pool);
 await tx((c:any)=>saveControlProfile(c,f.a,{deviceId:f.deviceId,permission:'allowed',mode:'remote',protection:'clear',loadType:'合成负载',offlineBehavior:'合成资料不推定实际行为',powerLossBehavior:'待实物核实',powerReturnBehavior:'待实物核实',protocolRef:'仅工程测试',feedbackRef:'仅合成字段',validUntil:future(),requestKey:key()}));
 const rule=await tx((c:any)=>saveControlRule(c,f.a,{deviceId:f.deviceId,purpose:'合成申请',species:'测试物种',stage:'测试阶段',conditions:'不得实际下发',sourceRef:'软件测试',requestKey:key()}));
 await tx((c:any)=>reviewControlRule(c,f.b,{id:rule.id,action:'approve',evidence:'仅软件链路',requestKey:key()}));
 const r=await tx((c:any)=>requestControl(c,f.a,{deviceId:f.deviceId,ruleId:rule.id,purpose:'验证拦截',authorizationRef:'测试授权',conditions:'合成',requestKey:key()}));assert.equal(r.state,'blocked');assert.equal(r.dispatched,false);assert(r.blocked_reasons.length>=1);
 await tx((c:any)=>recordControlFeedback(c,f.a,{requestId:r.id,layer:'mechanical',result:'unknown',value:'不应被保存为到位',source:'field_observation',observedAt:now(),evidence:'无实际反馈',requestKey:key()}));
 assert.equal((await pool.query("SELECT value FROM control_feedback WHERE layer='mechanical'")).rows[0].value,null);
 await tx((c:any)=>recordTakeover(c,f.a,{deviceId:f.deviceId,requestId:r.id,person:'合成人员',manualDevice:'测试手动装置',conditions:'仅记录不执行',occurredAt:now(),evidence:'软件测试',requestKey:key()}));
 await assert.rejects(()=>pool.query('UPDATE control_requests SET dispatched=true WHERE id=$1',[r.id]));
 assert.equal((await pool.query("SELECT count(*) FROM jobs WHERE kind LIKE 'control.%'")).rows[0].count,'0');
}));
test('3C定时抓图关闭时不请求，合成只读回执可衔接图片队列且窗口防重',()=>withDb(async pool=>{
 const f=await fixture(pool),tx=(fn:any)=>transaction<any>(fn,pool),dir=await mkdtemp(join(tmpdir(),'crop-schedule-')),previous=process.env.CAMERA_READS_ENABLED;
 try{
 await tx((c:any)=>saveCameraCapabilities(c,f.a,{deviceId:f.deviceId,secretRef:'EZVIZ_ACCESS_TOKEN_SYNTHETIC',channel:1,live:false,playback:false,capture:true,readOnlyConfirmed:true,plaintextCaptureConfirmed:true,limitMonthCalls:100,captureEvidence:'仅隔离测试能力',contractVersion:'synthetic-v1',evidence:'仅工程测试',model:'synthetic',firmware:'v1',verified:true}));
 const s=await tx((c:any)=>saveCropSchedule(c,f.a,{deviceId:f.deviceId,intervalMinutes:15,enabled:true,nextAt:now(),evaluationMode:false,sourceRef:'合成定时抓图',requestKey:key()}));
 process.env.CAMERA_READS_ENABLED='0';await scheduleCrops(pool);assert.equal((await pool.query('SELECT state FROM crop_capture_runs')).rows[0].state,'blocked');assert.equal((await pool.query('SELECT count(*) FROM camera_reads')).rows[0].count,'0');
 await scheduleCrops(pool);assert.equal((await pool.query('SELECT count(*) FROM crop_capture_runs')).rows[0].count,'1');
 process.env.CAMERA_READS_ENABLED='1';await pool.query("UPDATE crop_schedules SET next_at=clock_timestamp()-interval '1 second' WHERE id=$1",[s.id]);await scheduleCrops(pool);
 const r=(await pool.query("SELECT * FROM crop_capture_runs WHERE state='waiting'")).rows[0];assert(r);
 const asset=await syntheticAsset(pool,f.a,f.objectId,localStore(join(dir,'original'),join(dir,'backup')),'rgb');
 await pool.query("UPDATE camera_reads SET state='ready',asset_id=$2,completed_at=now() WHERE id=$1",[r.camera_read_id,asset.id]);await scheduleCrops(pool);
 assert.equal((await pool.query('SELECT state FROM crop_capture_runs WHERE id=$1',[r.id])).rows[0].state,'queued');assert.equal((await pool.query('SELECT count(*) FROM crop_analyses')).rows[0].count,'1');
 await tx((c:any)=>toggleCropSchedule(c,f.a,{id:s.id,enabled:false,requestKey:key()}));
 }finally{if(previous===undefined)delete process.env.CAMERA_READS_ENABLED;else process.env.CAMERA_READS_ENABLED=previous;await rm(dir,{recursive:true,force:true});}
}));

