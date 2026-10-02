import type {Pool,PoolClient} from 'pg';
import type {Actor} from '../../platform/types';
import {AppError} from '../../platform/error';
import {uuid} from '../identity/common';
import {integer,text,choice} from '../../platform/validation';
import {scope,visible} from '../field/common';
import {database,transaction} from '../../db/pool';
import {enqueue,consumeOnce,type JobLease} from '../jobs/repository';
import {assertLease,withLease} from '../jobs/execution';
import {calculateMetric} from '../analysis/service';
import {createBriefing} from './service';
export async function saveSchedule(c:PoolClient,a:Actor,b:Record<string,unknown>){uuid(b.objectId);await scope(c,a,b.objectId,'configure');await scope(c,a,b.objectId,'record');if(b.substituteId){uuid(b.substituteId);const u=(await c.query('SELECT role,enabled FROM users WHERE id=$1',[b.substituteId])).rows[0];if(!u?.enabled||!['technician','owner'].includes(u.role))throw new AppError(422,'SUBSTITUTE_SCOPE','替班人应为可用技术员或负责人');await scope(c,{id:b.substituteId,role:u.role,enabled:true,mfaVerified:true},b.objectId,'review');}const period=choice(b.period??'daily',['daily','weekly','monthly'] as const,'周期');const user=(await c.query('SELECT auth_version FROM users WHERE id=$1',[a.id])).rows[0];return(await c.query('INSERT INTO briefing_schedules(object_id,author_id,auth_version,hour,minute,enabled,evidence,substitute_id,created_by,period) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$2,$9) ON CONFLICT(object_id,period) DO UPDATE SET author_id=excluded.author_id,auth_version=excluded.auth_version,hour=excluded.hour,minute=excluded.minute,enabled=excluded.enabled,evidence=excluded.evidence,substitute_id=excluded.substitute_id,version=briefing_schedules.version+1,last_window_end=NULL,last_day=NULL RETURNING id,hour,minute,enabled,period',[b.objectId,a.id,user.auth_version,integer(b.hour,'生成小时',0,23),integer(b.minute,'生成分钟',0,59),b.enabled===true,text(b.evidence,'日程及替班安排依据',2000),b.substituteId??null,period])).rows[0];}

export function completedPeriod(period:'daily'|'weekly'|'monthly',at:Date){
 const local=new Date(at.getTime()+8*3600000);local.setUTCHours(0,0,0,0);
 if(period==='weekly')local.setUTCDate(local.getUTCDate()-(local.getUTCDay()+6)%7);
 if(period==='monthly')local.setUTCDate(1);
 const end=new Date(local.getTime()-8*3600000);if(period==='monthly')local.setUTCMonth(local.getUTCMonth()-1);else local.setUTCDate(local.getUTCDate()-(period==='weekly'?7:1));
 return {from:new Date(local.getTime()-8*3600000),to:end};
}
async function scheduledActor(c:PoolClient,r:any){const u=(await c.query('SELECT role,enabled,auth_version FROM users WHERE id=$1',[r.actor_id??r.author_id])).rows[0];if(!u?.enabled||u.auth_version!==r.auth_version)throw new AppError(403,'SCHEDULE_AUTH_CHANGED','日程执行主体或授权已变更');const a:Actor={id:r.actor_id??r.author_id,role:u.role,enabled:true,mfaVerified:true};await scope(c,a,r.object_id,'read');await scope(c,a,r.object_id,'record');return a;}
async function queueCalculation(c:PoolClient,s:any,d:any,from:Date,to:Date,key:string,reason:string,at:Date){
 const r=(await c.query('INSERT INTO analysis_calculations(object_id,definition_id,actor_id,auth_version,window_start,window_end,business_key,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(business_key) DO NOTHING RETURNING id',[s.object_id,d.id,s.author_id,s.auth_version,from,to,key,reason])).rows[0]??(await c.query('SELECT id FROM analysis_calculations WHERE business_key=$1',[key])).rows[0];
 await enqueue(c,{kind:'metric.calculate',businessKey:'calculate:'+r.id,payload:{calculationId:r.id},dueAt:at.toISOString(),priority:40});return r.id as string;
}
export async function generateDue(pool:Pool,at=new Date()){
 return transaction(async c=>{
  const schedules=(await c.query('SELECT * FROM briefing_schedules WHERE enabled ORDER BY object_id,period FOR UPDATE SKIP LOCKED')).rows,created:string[]=[],hourEnd=new Date(Math.floor(at.getTime()/3600000)*3600000),minute=new Date(at.getTime()+8*3600000).getUTCHours()*60+at.getUTCMinutes(),hourly=new Set<string>();
  for(const s of schedules){try{await scheduledActor(c,s);}catch{continue;}
   const definitions=(await c.query('SELECT id,specification FROM metric_definitions WHERE object_id=$1 AND approved_at IS NOT NULL AND retired_at IS NULL',[s.object_id])).rows;
   if(!hourly.has(s.object_id)){for(const d of definitions){const end=d.specification.formula==='gdd'?completedPeriod('daily',at).to:hourEnd,start=d.specification.formula==='gdd'?new Date(d.specification.startDate):new Date(end.getTime()-3600000);await queueCalculation(c,s,d,start,end,'hourly:'+d.id+':'+s.author_id+':'+s.auth_version+':'+end.toISOString(),'每小时指标',at);}hourly.add(s.object_id);}
   const window=completedPeriod(s.period,at);if(minute<s.hour*60+s.minute||s.last_window_end&&s.last_window_end>=window.to)continue;
   const key='schedule:'+s.id+':'+s.version+':'+window.to.toISOString(),calculationIds:string[]=[];
   for(const d of definitions)calculationIds.push(await queueCalculation(c,s,d,d.specification.formula==='gdd'?new Date(d.specification.startDate):window.from,window.to,key+':'+d.id,'周期报告指标',at));
   const r=(await c.query('INSERT INTO scheduled_briefings(schedule_id,schedule_version,object_id,actor_id,auth_version,period,window_start,window_end,calculation_ids,business_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(business_key) DO NOTHING RETURNING id',[s.id,s.version,s.object_id,s.author_id,s.auth_version,s.period,window.from,window.to,calculationIds,key])).rows[0]??(await c.query('SELECT id FROM scheduled_briefings WHERE business_key=$1',[key])).rows[0];
   await enqueue(c,{kind:'briefing.generate',businessKey:'scheduled-briefing:'+r.id,payload:{generationId:r.id},dueAt:at.toISOString(),priority:20});await c.query('UPDATE briefing_schedules SET last_window_end=$2,last_day=$3 WHERE id=$1',[s.id,window.to,window.to.toISOString().slice(0,10)]);created.push(r.id);
  }
  const events=(await c.query(`SELECT e.id,e.object_id,e.payload FROM domain_events e WHERE e.event_type IN('reading.recorded','reading.conflict') AND NOT EXISTS(SELECT 1 FROM consumer_offsets x WHERE x.consumer='analysis-schedule' AND x.event_id=e.id) ORDER BY e.recorded_at,e.id LIMIT 200`)).rows;
  for(const e of events)await consumeOnce(c,'analysis-schedule',e.id,async()=>{
   const o=(await c.query('SELECT point_id,sampled_at FROM observations WHERE id=$1 OR head_id=$2 ORDER BY received_at DESC LIMIT 1',[e.payload.observationId??null,e.payload.headId??null])).rows[0];if(!o?.sampled_at||o.sampled_at>=hourEnd)return;const s=schedules.find(s=>s.object_id===e.object_id);if(!s)return;try{await scheduledActor(c,s);}catch{return;}
   const defs=(await c.query('SELECT id,specification FROM metric_definitions WHERE object_id=$1 AND point_id=$2 AND approved_at IS NOT NULL AND retired_at IS NULL',[e.object_id,o.point_id])).rows;
   for(const d of defs){const hour=new Date(Math.floor(o.sampled_at.getTime()/3600000)*3600000),day=completedPeriod('daily',new Date(o.sampled_at.getTime()+86400000));const windows=d.specification.formula==='gdd'?[{from:new Date(d.specification.startDate),to:completedPeriod('daily',at).to}]:[{from:hour,to:new Date(hour.getTime()+3600000)},day];for(const w of windows)if(w.to<=at)await queueCalculation(c,s,d,w.from,w.to,'late:'+e.id+':'+d.id+':'+w.to.toISOString(),'补传发现',at);}
  });return created;
 },pool);
}
export async function runCalculation(pool:Pool,id:string,lease?:JobLease,calculate=calculateMetric){
 return withLease(pool,'calculate:'+id,lease,async current=>{
  let failure:string|null=null;
  try{await transaction(async c=>{await assertLease(c,current);const r=(await c.query("SELECT * FROM analysis_calculations WHERE id=$1 AND state='queued' FOR UPDATE",[id])).rows[0];if(!r)return;const a=await scheduledActor(c,r);const result=await calculate(c,a,{definitionId:r.definition_id,from:r.window_start.toISOString(),to:r.window_end.toISOString()},new Date());await assertLease(c,current);await scheduledActor(c,r);await c.query("UPDATE analysis_calculations SET state='complete',result_id=$2,completed_at=now() WHERE id=$1",[id,result.id]);},pool);}
  catch(e){if(e instanceof AppError&&e.code==='LEASE_LOST')throw e;failure=e instanceof AppError?e.code:'CALCULATION_FAILED';}
  if(failure)await transaction(async c=>{await assertLease(c,current);await c.query("UPDATE analysis_calculations SET state='failed',error_code=$2,completed_at=now() WHERE id=$1",[id,failure]);},pool);
 });
}
export async function runScheduledBriefing(pool:Pool,id:string,lease?:JobLease){
 return withLease(pool,'scheduled-briefing:'+id,lease,async current=>{
  await transaction(async c=>{await assertLease(c,current);const r=(await c.query("SELECT * FROM scheduled_briefings WHERE id=$1 AND state='queued' FOR UPDATE",[id])).rows[0];if(!r)return;const s=(await c.query('SELECT * FROM briefing_schedules WHERE id=$1',[r.schedule_id])).rows[0];if(!s?.enabled||s.version!==r.schedule_version){await c.query("UPDATE scheduled_briefings SET state='blocked',error_code='SCHEDULE_CHANGED' WHERE id=$1",[id]);return;}let a:Actor;try{a=await scheduledActor(c,r);}catch{await c.query("UPDATE scheduled_briefings SET state='blocked',error_code='SCHEDULE_AUTH_CHANGED' WHERE id=$1",[id]);return;}
   const calculations=(await c.query('SELECT state,error_code FROM analysis_calculations WHERE id=ANY($1::uuid[])',[r.calculation_ids])).rows,pending=calculations.some(x=>x.state==='queued');if(pending&&Date.now()-r.created_at.getTime()<120000)throw new AppError(409,'BRIEFING_METRICS_PENDING','程序指标仍在计算，报告稍后生成');
   const brief=await createBriefing(c,a,{objectIds:[r.object_id],period:r.period,from:r.window_start.toISOString(),to:r.window_end.toISOString(),requestKey:r.business_key});if(calculations.some(x=>x.state!=='complete'))await c.query("INSERT INTO briefing_items(briefing_id,object_id,kind,fact_refs,source_refs,original_text,limitations) VALUES($1,$2,'calculation_gap','[]','[]','部分程序指标未完成，不能据此判断正常',$3)",[brief.id,r.object_id,JSON.stringify([...new Set(calculations.filter(x=>x.state!=='complete').map(x=>x.error_code??'指标尚未完成'))])]);
   await assertLease(c,current);await c.query("UPDATE scheduled_briefings SET state='complete',briefing_id=$2,completed_at=now() WHERE id=$1",[id,brief.id]);if(s.substitute_id)await c.query("INSERT INTO briefing_reminders(briefing_id,recipient_id,state) VALUES($1,$2,'standby') ON CONFLICT DO NOTHING",[brief.id,s.substitute_id]);
  },pool);
 });
}
export async function listSchedules(c:PoolClient,a:Actor){const v=await visible(c,a,'briefing_item');if(a.role==='expert')return {items:[],calculations:[],generations:[]};return {items:(await c.query('SELECT id,object_id,period,hour,minute,enabled,version,last_window_end FROM briefing_schedules WHERE object_id=ANY($1::uuid[]) ORDER BY object_id,period',[v.objects])).rows,calculations:(await c.query('SELECT id,object_id,reason,state,error_code,window_start,window_end,result_id FROM analysis_calculations WHERE object_id=ANY($1::uuid[]) ORDER BY created_at DESC LIMIT 100',[v.objects])).rows,generations:(await c.query('SELECT id,object_id,period,state,error_code,briefing_id FROM scheduled_briefings WHERE object_id=ANY($1::uuid[]) ORDER BY created_at DESC LIMIT 50',[v.objects])).rows};}
