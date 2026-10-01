import type { PoolClient } from 'pg';
import type { Actor } from '../../platform/types';
import { AppError } from '../../platform/error';
import { listAccessibleObjects,assertAccess } from '../identity/access';
import { uuid } from '../identity/common';
import { enqueue,consumeOnce } from '../jobs/repository';
import type { ReadingInput } from '../telemetry/types';
import { evaluate,type RuleRuntime } from './evaluate';
import { ruleFromRow } from './rules';

export async function systemEvent(c:PoolClient,alert:{id:string;object_id:string},type:string,at:Date,note='',evidence:unknown[]=[],notify=false){
  const event=(await c.query('INSERT INTO alert_events(alert_id,event_type,occurred_at,note,evidence) VALUES($1,$2,$3,$4,$5) RETURNING id',[alert.id,type,at,note,JSON.stringify(evidence)])).rows[0];
  const domain=(await c.query('INSERT INTO domain_events(event_type,object_id,occurred_at,payload) VALUES($1,$2,$3,$4) RETURNING id',['alert.'+type,alert.object_id,at,{alertId:alert.id,eventId:event.id}])).rows[0];
  if(notify)await enqueue(c,{kind:'notification.plan',businessKey:'notice-plan:'+domain.id,payload:{eventId:domain.id,alertId:alert.id,change:type},dueAt:at.toISOString(),priority:100});
  return event.id as string;
}
export async function ensureAlert(c:PoolClient,input:{objectId:string;pointId?:string;bindingId?:string;versionId?:string;key:string;kind:'measurement'|'monitoring_gap'|'source_unavailable';title:string;severity:string;quality:string},at:Date,evidence:unknown[]=[]){
  const created=(await c.query(`INSERT INTO alerts(object_id,point_id,rule_binding_id,rule_version_id,correlation_key,kind,title,severity,data_quality,opened_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(correlation_key) WHERE state<>'closed' DO NOTHING RETURNING *`,[input.objectId,input.pointId??null,input.bindingId??null,input.versionId??null,input.key,input.kind,input.title,input.severity,input.quality,at])).rows[0];
  if(created){await systemEvent(c,created,'opened',at,'',evidence,true);return created;}
  let alert=(await c.query("SELECT * FROM alerts WHERE correlation_key=$1 AND state<>'closed' FOR UPDATE",[input.key])).rows[0];
  if(alert.state==='recovered'){
    alert=(await c.query("UPDATE alerts SET state='open',data_quality=$2,recovered_at=NULL,recurrences=recurrences+1 WHERE id=$1 RETURNING *",[alert.id,input.quality])).rows[0];
    await systemEvent(c,alert,'recurred',at,'',evidence,true);
  }
  return alert;
}
async function recoverAlert(c:PoolClient,key:string,at:Date,note:string){
  const row=(await c.query("UPDATE alerts SET state='recovered',recovered_at=$2 WHERE correlation_key=$1 AND state='open' RETURNING *",[key,at])).rows[0];
  if(row)await systemEvent(c,row,'recovered',at,note,[],true);
}
export async function evaluateObservation(c:PoolClient,eventId:string,observationId:string,at=new Date()){
  uuid(eventId);uuid(observationId);
  return consumeOnce(c,'alarms-v1',eventId,async()=>{
    const o=(await c.query('SELECT o.*,h.conflicted FROM observations o JOIN observation_heads h ON h.id=o.head_id WHERE o.id=$1',[observationId])).rows[0];if(!o)return;
    const bindings=(await c.query(`SELECT b.*,v.id AS version_id FROM rule_bindings b JOIN rule_versions v ON v.id=b.active_version_id
      WHERE b.point_id=$1 AND b.object_id=$2 AND b.enabled ORDER BY b.id FOR UPDATE OF b`,[o.point_id,o.object_id])).rows;
    for(const b of bindings){
      const v=(await c.query('SELECT * FROM rule_versions WHERE id=$1',[b.version_id])).rows[0];
      const rt=(await c.query('SELECT r.*,a.state AS active_state FROM rule_runtime r LEFT JOIN alerts a ON a.id=r.active_alert_id WHERE binding_id=$1',[b.id])).rows[0];
      const previous:RuleRuntime|null=rt?{versionId:rt.version_id,lastSampledAt:rt.last_sampled_at?.toISOString()??null,candidateStartedAt:rt.candidate_started_at?.toISOString()??null,previousMatched:rt.previous_matched,activeAlertId:rt.active_state==='closed'?null:rt.active_alert_id,activeState:rt.active_state==='closed'?null:rt.active_state}:null;
      if(o.conflicted){
        // A correction to a sample in the candidate window invalidates continuity, never declares recovery.
        const relevant=o.sampled_at&&(previous?.lastSampledAt?o.sampled_at.getTime()>=Date.parse(previous.candidateStartedAt??previous.lastSampledAt):at.getTime()-o.sampled_at.getTime()>=0&&at.getTime()-o.sampled_at.getTime()<=v.max_age_ms);
        if(!relevant)continue;
        await c.query('UPDATE rule_runtime SET candidate_started_at=NULL,previous_matched=false WHERE binding_id=$1',[b.id]);
        await ensureAlert(c,{objectId:b.object_id,pointId:b.point_id,bindingId:b.id,versionId:v.id,key:'gap:'+b.id,kind:'monitoring_gap',title:b.name+'：数据冲突，需核查',severity:'warning',quality:'suspect'},at,[{kind:'reading',id:o.id}]);
        if(previous?.activeAlertId&&previous.activeState==='open'){const alert=(await c.query("UPDATE alerts SET data_quality='suspect' WHERE id=$1 RETURNING *",[previous.activeAlertId])).rows[0];await systemEvent(c,alert,'data_conflict',at,'原始测值出现冲突，须人工核查',[{kind:'reading',id:o.id}],true);}
        continue;
      }
      const sample:ReadingInput={sourceId:o.source_id,sourceRecordId:o.source_record_id,externalDeviceId:o.external_device_id,pointId:o.point_id,metric:o.metric,sampledAt:o.sampled_at?.toISOString()??null,reportedAt:o.reported_at?.toISOString()??null,receivedAt:o.received_at.toISOString(),sequence:o.sequence,rawValue:o.raw_value,value:o.value===null?null:Number(o.value),unit:o.unit,quality:o.quality,reasons:o.reasons,origin:o.origin,rawRef:o.raw_ref,mappingVersion:o.binding_id};
      const result=evaluate(ruleFromRow(v),previous,sample,at);let activeId=previous?.activeAlertId??null;
      if(['old_sample','already_processed','rule_inactive','not_applicable'].includes(result.reason))continue;
      if(result.kind==='monitoring_gap')await ensureAlert(c,{objectId:b.object_id,pointId:b.point_id,bindingId:b.id,versionId:v.id,key:'gap:'+b.id,kind:'monitoring_gap',title:b.name+'：监测需现场核查',severity:'warning',quality:'suspect'},at,[{kind:'reading',id:o.id}]);
      else {
        await recoverAlert(c,'gap:'+b.id,at,'新有效测值恢复；现场核查仍需留痕');
        if(result.kind==='open'){const alert=await ensureAlert(c,{objectId:b.object_id,pointId:b.point_id,bindingId:b.id,versionId:v.id,key:'rule:'+b.id,kind:'measurement',title:b.name,severity:v.severity,quality:'valid'},at,[{kind:'reading',id:o.id}]);activeId=alert.id;}
        if(result.kind==='recovered')await recoverAlert(c,'rule:'+b.id,at,'新有效测值不再满足越限条件；尚未关闭');
        if(result.kind==='continue'&&activeId){const alert=(await c.query("UPDATE alerts SET continuations=continuations+1,data_quality='valid' WHERE id=$1 RETURNING *",[activeId])).rows[0];await systemEvent(c,alert,'continued',at,'',[{kind:'reading',id:o.id}]);}
      }
      await c.query(`INSERT INTO rule_runtime(binding_id,version_id,last_observation_id,last_sampled_at,candidate_started_at,previous_matched,active_alert_id)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(binding_id) DO UPDATE SET version_id=$2,last_observation_id=$3,last_sampled_at=$4,candidate_started_at=$5,previous_matched=$6,active_alert_id=$7`,[b.id,v.id,o.id,o.sampled_at,result.candidateStartedAt,result.matched,activeId]);
    }
  });
}
export async function scanMonitoringGaps(c:PoolClient,at=new Date()){
  const rows=(await c.query(`SELECT b.*,v.max_age_ms,v.effective_from,v.effective_to,v.approved_by,p.sampled_at,d.source_id,h.state AS source_state
    FROM rule_bindings b JOIN rule_versions v ON v.id=b.active_version_id JOIN points pt ON pt.id=b.point_id JOIN devices d ON d.id=pt.device_id
    LEFT JOIN point_current p ON p.point_id=b.point_id LEFT JOIN source_health h ON h.source_id=d.source_id WHERE b.enabled ORDER BY b.id FOR UPDATE OF b`)).rows;
  for(const b of rows){
    if(!b.approved_by||b.effective_from>at||(b.effective_to&&b.effective_to<=at))continue;
    const last=b.sampled_at??b.enabled_at;
    if(last&&at.getTime()-last.getTime()>b.max_age_ms){await c.query('UPDATE rule_runtime SET candidate_started_at=NULL,previous_matched=false WHERE binding_id=$1',[b.id]);await ensureAlert(c,{objectId:b.object_id,pointId:b.point_id,bindingId:b.id,versionId:b.active_version_id,key:'gap:'+b.id,kind:'monitoring_gap',title:b.name+'：监测中断，需现场核查',severity:'warning',quality:'suspect'},at);}
    const key='source:'+b.source_id+':'+b.object_id;
    if(b.source_state&&b.source_state!=='ok'&&b.source_state!=='unknown')await ensureAlert(c,{objectId:b.object_id,key,kind:'source_unavailable',title:'厂家来源不可用：现场核查与接入排障',severity:'warning',quality:'suspect'},at);
    else if(b.source_state==='ok')await recoverAlert(c,key,at,'来源最近一次通信恢复；测值新鲜度单独检查');
  }
}
export async function listAlerts(c:PoolClient,actor:Actor,limit=50,offset=0){
  const ids=await listAccessibleObjects(c,actor,'read');
  return {items:(await c.query(`SELECT a.*,o.name AS object_name FROM alerts a JOIN objects o ON o.id=a.object_id WHERE a.object_id=ANY($1::uuid[])
    ORDER BY CASE a.state WHEN 'open' THEN 0 WHEN 'recovered' THEN 1 ELSE 2 END,a.opened_at DESC LIMIT $2 OFFSET $3`,[ids,limit,offset])).rows,
    total:Number((await c.query('SELECT count(*) FROM alerts WHERE object_id=ANY($1::uuid[])',[ids])).rows[0].count)};
}
export async function getAlert(c:PoolClient,actor:Actor,id:string){
  uuid(id);const row=(await c.query('SELECT a.*,o.name AS object_name FROM alerts a JOIN objects o ON o.id=a.object_id WHERE a.id=$1',[id])).rows[0];
  if(!row)throw new AppError(404,'ALERT_NOT_FOUND','事件不存在');await assertAccess(c,actor,{objectId:row.object_id,action:'read',at:new Date().toISOString()});
  const events=(await c.query('SELECT e.*,u.display_name AS actor_name FROM alert_events e LEFT JOIN users u ON u.id=e.actor_id WHERE alert_id=$1 ORDER BY occurred_at,id LIMIT 500',[id])).rows;
  const claims=(await c.query('SELECT c.*,u.display_name AS actor_name FROM alert_claims c JOIN users u ON u.id=c.actor_id WHERE alert_id=$1 AND ended_at IS NULL',[id])).rows;
  const rule=row.rule_version_id?(await c.query('SELECT id,version,metric,unit,comparison,threshold,duration_ms,max_age_ms,max_gap_ms,source,approved_by,approval_evidence FROM rule_versions WHERE id=$1',[row.rule_version_id])).rows[0]:null;
  return {alert:row,events,claims,rule};
}
