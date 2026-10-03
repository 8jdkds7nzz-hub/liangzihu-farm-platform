import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';import {AppError} from '../../platform/error';
import {text,time,choice,optionalText} from '../../platform/validation';import {uuid} from '../identity/common';import {scope} from '../field/common';import {request,type Body} from '../inventory/common';
async function device(c:PoolClient,a:Actor,id:unknown,action:'record'|'configure'|'review'|'act'='record'){
 uuid(id);const r=(await c.query('SELECT * FROM devices WHERE id=$1',[id])).rows[0];if(!r)throw new AppError(404,'DEVICE_NOT_FOUND','设备不存在');
 await scope(c,a,r.object_id,'read');await scope(c,a,r.object_id,action);return r;
}
export async function saveControlProfile(c:PoolClient,a:Actor,b:Body){
 const d=await device(c,a,b.deviceId,'configure');if(b.permission==='allowed')await scope(c,a,d.object_id,'review');
 return request(c,a,b,'control.profile',d.object_id,async()=>{
 await c.query('SELECT id FROM devices WHERE id=$1 FOR UPDATE',[d.id]);const v=Number((await c.query('SELECT COALESCE(max(version),0)+1 AS v FROM control_profiles WHERE device_id=$1',[d.id])).rows[0].v);
 return(await c.query('INSERT INTO control_profiles(object_id,device_id,version,permission,mode,protection,load_type,offline_behavior,power_loss_behavior,power_return_behavior,protocol_ref,feedback_ref,valid_until,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *',[d.object_id,d.id,v,choice(b.permission,['unknown','allowed','denied'] as const,'操作许可'),choice(b.mode,['unknown','manual','remote'] as const,'设备模式'),choice(b.protection,['unknown','active','clear'] as const,'现场保护'),text(b.loadType,'负载类型',200),text(b.offlineBehavior,'断网行为或未知说明',2000),text(b.powerLossBehavior,'停电行为或未知说明',2000),text(b.powerReturnBehavior,'复电行为或未知说明',2000),text(b.protocolRef,'实际协议依据或待核说明',2000),text(b.feedbackRef,'反馈含义依据或待核说明',2000),time(b.validUntil),a.id])).rows[0];
 });
}
export async function saveControlRule(c:PoolClient,a:Actor,b:Body){
 const d=await device(c,a,b.deviceId,'configure');return request(c,a,b,'control.rule',d.object_id,async()=>{
 await c.query('SELECT id FROM devices WHERE id=$1 FOR UPDATE',[d.id]);const v=Number((await c.query('SELECT COALESCE(max(version),0)+1 AS v FROM control_rules WHERE device_id=$1',[d.id])).rows[0].v);
 return(await c.query('INSERT INTO control_rules(object_id,device_id,version,purpose,species,stage,conditions,source_ref,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[d.object_id,d.id,v,text(b.purpose,'用途',1000),text(b.species,'物种',200),text(b.stage,'阶段',200),text(b.conditions,'触发、停止和人工接管条件',4000),text(b.sourceRef,'专业依据',4000),a.id])).rows[0];
 });
}
export async function reviewControlRule(c:PoolClient,a:Actor,b:Body){
 uuid(b.id);const r=(await c.query('SELECT * FROM control_rules WHERE id=$1',[b.id])).rows[0];if(!r)throw new AppError(404,'CONTROL_RULE_NOT_FOUND','规则不存在');await device(c,a,r.device_id,'review');
 return request(c,a,b,'control.rule-review',r.object_id,async()=>{
 const current=(await c.query('SELECT * FROM control_rules WHERE id=$1 FOR UPDATE',[r.id])).rows[0],action=choice(b.action,['approve','withdraw'] as const,'规则审核动作');
 if(action==='approve'&&(current.state!=='draft'||current.created_by===a.id))throw new AppError(409,'CONTROL_RULE_REVIEW','须其他审核人员确认规则草稿');
 return(await c.query('UPDATE control_rules SET state=$2,reviewed_by=$3,reviewed_at=now(),review_note=$4 WHERE id=$1 RETURNING *',[r.id,action==='approve'?'approved':'withdrawn',a.id,text(b.evidence,'专业审核依据',4000)])).rows[0];
 });
}
export async function requestControl(c:PoolClient,a:Actor,b:Body){
 const d=await device(c,a,b.deviceId,'act');await scope(c,a,d.object_id,'record');
 return request(c,a,b,'control.request',d.object_id,async()=>{
 const profile=(await c.query('SELECT * FROM control_profiles WHERE device_id=$1 ORDER BY version DESC LIMIT 1',[d.id])).rows[0];
 let rule:any=null;if(b.ruleId){uuid(b.ruleId);rule=(await c.query('SELECT * FROM control_rules WHERE id=$1 AND device_id=$2',[b.ruleId,d.id])).rows[0];if(!rule)throw new AppError(422,'CONTROL_RULE_SCOPE','规则不属于当前设备');}
 const reasons=['缺少该设备已联合签验的执行适配器，平台未下发任何命令'];
 if(!profile||+profile.valid_until<=Date.now())reasons.push('控制资料缺失或已到复核期限');
 if(profile?.permission!=='allowed')reasons.push('设备操作许可未确认');if(profile?.mode!=='remote')reasons.push('未确认处于远程模式');if(profile?.protection!=='clear')reasons.push('现场保护状态未知或生效');
 if(!rule||rule.state!=='approved')reasons.push('专业规则尚未批准');
 const r=(await c.query('INSERT INTO control_requests(object_id,device_id,profile_id,rule_id,purpose,authorization_ref,conditions,blocked_reasons,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[d.object_id,d.id,profile?.id??null,rule?.id??null,text(b.purpose,'申请目的',2000),text(b.authorizationRef,'本次授权依据',2000),text(b.conditions,'本次现场条件',4000),JSON.stringify(reasons),a.id])).rows[0];
 await c.query("INSERT INTO control_feedback(object_id,request_id,layer,result,value,source,observed_at,evidence,created_by) VALUES($1,$2,'request','observed','申请已登记，命令未下发','platform_record',now(),'平台本次仅建立准备记录',$3)",[d.object_id,r.id,a.id]);
 return r;
 });
}
export async function recordControlFeedback(c:PoolClient,a:Actor,b:Body){
 uuid(b.requestId);const r=(await c.query('SELECT * FROM control_requests WHERE id=$1',[b.requestId])).rows[0];if(!r)throw new AppError(404,'CONTROL_REQUEST_NOT_FOUND','申请不存在');await device(c,a,r.device_id);
 return request(c,a,b,'control.feedback',r.object_id,async()=>{
 const source=choice(b.source,['vendor_receipt','field_observation'] as const,'反馈来源'),layer=choice(b.layer,['device_received','electrical','mechanical','effect'] as const,'反馈层'),result=choice(b.result,['observed','not_observed','unknown'] as const,'观测结论');
 return(await c.query('INSERT INTO control_feedback(object_id,request_id,layer,result,value,source,observed_at,evidence,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[r.object_id,r.id,layer,result,result==='unknown'?null:optionalText(b.value,'反馈值',2000),source,time(b.observedAt),text(b.evidence,'外部凭证或现场观测依据（并非平台下发回执）',4000),a.id])).rows[0];
 });
}
export async function recordTakeover(c:PoolClient,a:Actor,b:Body){
 const d=await device(c,a,b.deviceId);return request(c,a,b,'control.takeover',d.object_id,async()=>{
 if(b.requestId){uuid(b.requestId);if((await c.query('SELECT device_id FROM control_requests WHERE id=$1',[b.requestId])).rows[0]?.device_id!==d.id)throw new AppError(422,'CONTROL_REQUEST_SCOPE','接管申请与设备不一致');}
 return(await c.query('INSERT INTO control_takeovers(object_id,device_id,request_id,person,manual_device,conditions,occurred_at,evidence,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[d.object_id,d.id,b.requestId||null,text(b.person,'实际到场人',200),text(b.manualDevice,'手动装置',2000),text(b.conditions,'现场条件',4000),time(b.occurredAt),text(b.evidence,'接管依据',4000),a.id])).rows[0];
 });
}

