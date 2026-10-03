import type { PoolClient } from 'pg';
import type { Actor } from '../../platform/types';
import { AppError } from '../../platform/error';
import { time } from '../../platform/validation';
import { assertAccess } from '../identity/access';
import { audit, digest, uuid } from '../identity/common';
import { publicAsset } from '../media/service';
import { canonicalJson } from '../../platform/json';
import {exportBusinessRelations} from './business-export';
import {financialRole} from '../finance/access';
async function rows(c: PoolClient, sql: string, params: unknown[]) { const r = (await c.query(sql + ' LIMIT 5001', params)).rows; if (r.length > 5000)
    throw new AppError(422, 'EXPORT_TOO_LARGE', '该范围超过单次导出上限，请缩小对象或时间范围'); return r; }
async function chains(c: PoolClient, table: 'maintenance_records' | 'manual_checks', ids: unknown[], from: string, to: string) {
    return rows(c, `WITH RECURSIVE chain AS (
  SELECT * FROM ${table} WHERE object_id=ANY($1::uuid[]) AND occurred_at>=$2 AND occurred_at<$3
  UNION SELECT p.* FROM ${table} p JOIN chain n ON p.id=n.supersedes_id OR p.supersedes_id=n.id WHERE p.object_id=ANY($1::uuid[])
) SELECT * FROM chain ORDER BY occurred_at,id`, [ids, from, to]);
}
export async function createExport(c: PoolClient, actor: Actor, b: Record<string, unknown>) {
    if(actor.role==='expert')throw new AppError(403,'EXPERT_EXPORT_SCOPE','专家只导出明确事项的受控内容，不能打包整个对象历史');
    const ids = Array.isArray(b.objectIds) ? b.objectIds : [b.objectId];
    if (!ids.length || ids.length > 20)
        throw new AppError(400, 'EXPORT_SCOPE', '一次选择1至20个对象');
    for (const id of ids) {
        uuid(id);
        await assertAccess(c, actor, { objectId: id, action: 'export', at: new Date().toISOString() });await assertAccess(c, actor, {objectId:id,action:'read',at:new Date().toISOString()});
    }
    const from = time(b.from), to = time(b.to);
    if (from >= to || Date.parse(to) - Date.parse(from) > 31 * 86400000)
        throw new AppError(400, 'EXPORT_PERIOD', '导出时间须为正且不超过31天');
    const observations = await rows(c, `SELECT o.*,h.conflicted,(h.canonical_id=o.id) AS canonical FROM observations o JOIN observation_heads h ON h.id=o.head_id WHERE object_id=ANY($1::uuid[]) AND sampled_at>=$2 AND sampled_at<$3 ORDER BY sampled_at,o.id`, [ids, from, to]);
    const maintenance = await chains(c, 'maintenance_records', ids, from, to);
    const manualChecks = await chains(c, 'manual_checks', ids, from, to);
    const bindings = await rows(c, 'SELECT * FROM point_bindings WHERE object_id=ANY($1::uuid[]) ORDER BY valid_from,id', [ids]);
    const points = await rows(c, 'SELECT p.* FROM points p JOIN devices d ON d.id=p.device_id WHERE d.object_id=ANY($1::uuid[]) ORDER BY p.id', [ids]);
    const devices = await rows(c, 'SELECT * FROM devices WHERE object_id=ANY($1::uuid[]) ORDER BY id', [ids]);
    const alerts = await rows(c, 'SELECT * FROM alerts WHERE object_id=ANY($1::uuid[]) ORDER BY opened_at,id', [ids]);
    const rules = await rows(c, 'SELECT v.* FROM rule_versions v JOIN rule_bindings b ON b.id=v.binding_id WHERE b.object_id=ANY($1::uuid[])', [ids]);
    const workOrders = await rows(c, 'SELECT * FROM work_orders WHERE object_id=ANY($1::uuid[])', [ids]);
    const payload = { schemaVersion: '1c-v2', exportedAt: new Date().toISOString(), scope: { objectIds: ids, from, to }, limits: { measurements: '测值和维护按时段，附相关更正链；配置保留关系，最多各5000条', rawBodies: '不含原报文正文；完整原始字节由数据库备份保留', externalReferences: '范围外父对象、父设备及人员仅保留ID引用；不会导出其未授权资料' },
        objects: await rows(c, 'SELECT id,parent_id,code,name,kind,boundary_status,source,version FROM objects WHERE id=ANY($1::uuid[])', [ids]),
        objectVersions: await rows(c, 'SELECT * FROM object_versions WHERE object_id=ANY($1::uuid[])', [ids]), points, devices, bindings, observations,
        batches: await rows(c, 'SELECT * FROM production_batches WHERE object_id=ANY($1::uuid[])', [ids]), rules,
        ruleBindings: await rows(c, 'SELECT * FROM rule_bindings WHERE object_id=ANY($1::uuid[])', [ids]), alerts,
        alertEvents: await rows(c, 'SELECT * FROM alert_events WHERE alert_id=ANY($1::uuid[])', [alerts.map(a => a.id)]), maintenance, manualChecks, workOrders,
        workOrderEvents: await rows(c, 'SELECT * FROM work_order_events WHERE work_order_id=ANY($1::uuid[])', [workOrders.map(w => w.id)]),
        rawReferences: await rows(c, 'SELECT id,source_id,received_at,sha256,octet_length(body) AS byte_length,synthetic,contract_version,contract_ref,contract_sha256 FROM raw_receipts WHERE id=ANY($1::uuid[])', [[...new Set(observations.map(o => o.raw_ref))]]),
        sources: await rows(c, 'SELECT id,code,name,provider,verified FROM data_sources WHERE id=ANY($1::uuid[]) AND object_id=ANY($2::uuid[])', [[...new Set(devices.map(d => d.source_id))],ids]) };
    const farmRecords=await rows(c,'SELECT * FROM farm_records WHERE object_id=ANY($1::uuid[])',[ids]),
      media=(await rows(c,'SELECT * FROM media_assets WHERE object_id=ANY($1::uuid[])',[ids])).map(publicAsset),
      fieldTasks=await rows(c,'SELECT * FROM field_tasks WHERE object_id=ANY($1::uuid[])',[ids]),
      flights=await rows(c,'SELECT id,object_id,source_id,external_id,started_at,finished_at,aircraft_model,dock_model,provider_version,source_ref,crs,capture_conditions,payloads,manifest_hash FROM flights WHERE object_id=ANY($1::uuid[])',[ids]);
    Object.assign(payload,{
      boundaryVersions:await rows(c,'SELECT id,object_id,object_version,ST_AsGeoJSON(boundary)::jsonb AS boundary,source_crs,source,status,confirmed_by,created_by,created_at FROM boundary_versions WHERE object_id=ANY($1::uuid[])',[ids]),devicePositions:await rows(c,'SELECT id,object_id,device_id,version,ST_AsGeoJSON(position)::jsonb AS position,source,verified,created_at FROM device_positions WHERE object_id=ANY($1::uuid[])',[ids]),farmRecords,media,recordAttachments:await rows(c,'SELECT * FROM record_attachments WHERE record_id=ANY($1::uuid[])',[farmRecords.map(r=>r.id)]),
      recordReviews:await rows(c,'SELECT * FROM record_reviews WHERE record_id=ANY($1::uuid[])',[farmRecords.map(r=>r.id)]),
      fieldTasks,taskEvents:await rows(c,'SELECT * FROM field_task_events WHERE task_id=ANY($1::uuid[])',[fieldTasks.map(r=>r.id)]),
      inspections:await rows(c,'SELECT * FROM inspection_reports WHERE object_id=ANY($1::uuid[])',[ids]),irrigation:await rows(c,'SELECT * FROM irrigation_entries WHERE object_id=ANY($1::uuid[])',[ids]),
      calendars:await rows(c,'SELECT * FROM calendar_versions WHERE object_id=ANY($1::uuid[])',[ids]),cameraEvents:await rows(c,'SELECT * FROM camera_events WHERE object_id=ANY($1::uuid[])',[ids]),
      flightCoverages:await rows(c,'SELECT id,flight_id,object_id,version,ST_AsGeoJSON(geometry)::jsonb AS geometry,source_crs,source_ref,status,created_by,created_at FROM flight_coverages WHERE object_id=ANY($1::uuid[])',[ids]),flightRasters:await rows(c,'SELECT * FROM flight_rasters WHERE object_id=ANY($1::uuid[])',[ids]),flights,flightFiles:await rows(c,'SELECT * FROM flight_files WHERE flight_id=ANY($1::uuid[])',[flights.map(r=>r.id)]),flightAnnotations:await rows(c,'SELECT * FROM flight_annotations WHERE flight_id=ANY($1::uuid[])',[flights.map(r=>r.id)]),
      metricDefinitions:await rows(c,'SELECT * FROM metric_definitions WHERE object_id=ANY($1::uuid[])',[ids]),metrics:await rows(c,'SELECT * FROM metric_results WHERE object_id=ANY($1::uuid[])',[ids]),
      weather:await rows(c,'SELECT * FROM weather_records WHERE object_id=ANY($1::uuid[])',[ids]),weatherConnections:await rows(c,'SELECT id,object_id,source_id,version,location_evidence,evidence,enabled,configured_at FROM weather_connections WHERE object_id=ANY($1::uuid[])',[ids]),weatherRuns:await rows(c,'SELECT id,connection_id,configuration_version,object_id,state,created_at,attempted_at,completed_at,error_code,response_sha256,record_ids FROM weather_sync_runs WHERE object_id=ANY($1::uuid[])',[ids]),knowledge:await rows(c,'SELECT id,title,version,object_ids,source_ref,source_checksum,body,evidence_nature,state,approved_at,withdrawn_at FROM knowledge_documents WHERE object_ids<@$1::uuid[]',[ids]),
      briefings:await rows(c,'SELECT * FROM briefing_items WHERE object_id=ANY($1::uuid[])',[ids]),imageReviews:await rows(c,'SELECT * FROM image_reviews WHERE object_id=ANY($1::uuid[])',[ids])
    });
    const briefings=await rows(c,"SELECT b.* FROM briefings b WHERE EXISTS(SELECT 1 FROM briefing_items i WHERE i.briefing_id=b.id AND i.object_id=ANY($1::uuid[])) AND NOT EXISTS(SELECT 1 FROM briefing_items i WHERE i.briefing_id=b.id AND NOT(i.object_id=ANY($1::uuid[])))",[ids]),bids=briefings.map(r=>r.id);
    const samples=await rows(c,'SELECT * FROM image_field_samples WHERE object_id=ANY($1::uuid[])',[ids]);
    Object.assign(payload,{
      briefingHeaders:briefings,briefingSchedules:await rows(c,'SELECT * FROM briefing_schedules WHERE object_id=ANY($1::uuid[])',[ids]),
      briefingReviews:await rows(c,'SELECT r.* FROM briefing_reviews r JOIN briefing_items i ON i.id=r.item_id WHERE i.object_id=ANY($1::uuid[])',[ids]),
      briefingPublications:await rows(c,'SELECT * FROM briefing_publications WHERE briefing_id=ANY($1::uuid[])',[bids]),briefingReminders:await rows(c,'SELECT * FROM briefing_reminders WHERE briefing_id=ANY($1::uuid[])',[bids]),
      calculations:await rows(c,'SELECT * FROM analysis_calculations WHERE object_id=ANY($1::uuid[])',[ids]),scheduledBriefings:await rows(c,'SELECT * FROM scheduled_briefings WHERE object_id=ANY($1::uuid[])',[ids]),
      comparisonDefinitions:await rows(c,'SELECT * FROM comparison_definitions WHERE object_id=ANY($1::uuid[])',[ids]),comparisonResults:await rows(c,'SELECT * FROM comparison_results WHERE object_id=ANY($1::uuid[])',[ids]),
      imageSamples:samples,imageLabels:samples.filter(s=>s.labelled_at).map(s=>({sampleId:s.id,labels:s.human_labels,labelledBy:s.labelled_by,labelledAt:s.labelled_at})),
      cameraReads:await rows(c,'SELECT id,device_id,object_id,source_id,source_contract_ref,configuration_version,operation,parameters,state,asset_id,error_code,created_at,attempted_at,completed_at FROM camera_reads WHERE object_id=ANY($1::uuid[])',[ids])
    });
    const terrainScenes=await rows(c,'SELECT id,object_id,flight_id,name,version,supersedes_id,root_path,captured_at,source_crs,survey_crs,vertical_datum,conversion_ref,source_ref,surface_state,patches,repairs_declared,state,validation,error_code,created_at,completed_at,withdrawn_at,withdraw_reason FROM terrain_scenes WHERE object_id=ANY($1::uuid[])',[ids]),sceneIds=terrainScenes.map(s=>s.id);
    Object.assign(payload,{terrainSchemaVersion:'2c-v1',terrainScenes,
      terrainResources:await rows(c,'SELECT * FROM terrain_resources WHERE scene_id=ANY($1::uuid[])',[sceneIds]),
      terrainSurveys:await rows(c,'SELECT s.*,ST_AsGeoJSON(position)::jsonb AS location FROM terrain_surveys s WHERE object_id=ANY($1::uuid[])',[ids]),
      terrainReviews:await rows(c,'SELECT * FROM terrain_reviews WHERE object_id=ANY($1::uuid[])',[ids]),
      deviceElevations:await rows(c,'SELECT * FROM device_elevations WHERE object_id=ANY($1::uuid[])',[ids]),
      hydraulicLinks:await rows(c,'SELECT * FROM hydraulic_links WHERE object_id=ANY($1::uuid[]) AND to_object_id=ANY($1::uuid[])',[ids])});
    payload.limits.externalReferences+='；已迁出范围的设备/测点不带当前台账；跨对象简报发布须全部对象在本次选择内；连通关系两端都在导出范围才包含';
    payload.limits.measurements+='；1b/1c关系与修订历史保留，附件原件使用另一个受控打包入口逐文件复核';
    Object.assign(payload,await exportBusinessRelations(c,actor,ids as string[]));
    payload.limits.measurements+='；三四期业务按所选对象保留关系与版本，角色和跨对象排除项见businessScopeNotices';
    const encoded = canonicalJson(payload);
    if (Buffer.byteLength(encoded) > 8 * 1024 * 1024)
        throw new AppError(422, 'EXPORT_TOO_LARGE', '导出超过8MB，请缩小范围');
    const row = (await c.query('INSERT INTO export_tasks(created_by,object_ids,from_at,to_at,payload,sha256) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,expires_at', [actor.id, ids, from, to, payload, digest(encoded)])).rows[0];
    await audit(c, actor.id, 'export_created', row.id);
    return { ...row, state: 'ready', downloadUrl: '/api/v1/exports/' + row.id, bundleUrl:'/api/v1/exports/'+row.id+'/bundle' };
}
export async function downloadExport(c: PoolClient, actor: Actor, id: string) {
    uuid(id);
    const row = (await c.query('SELECT * FROM export_tasks WHERE id=$1 AND created_by=$2 AND expires_at>clock_timestamp()', [id, actor.id])).rows[0];
    if (!row)
        throw new AppError(404, 'EXPORT_NOT_FOUND', '导出不存在、已过期或不属于此账号');
    if(row.payload.phase4?.financeIncluded)financialRole(actor);
    for (const objectId of row.object_ids)
        {await assertAccess(c, actor, { objectId, action: 'export', at: new Date().toISOString() });await assertAccess(c,actor,{objectId,action:'read',at:new Date().toISOString()});}
    const body = canonicalJson(row.payload);
    if (digest(body) !== row.sha256)
        throw new AppError(503, 'EXPORT_INTEGRITY', '导出内容校验失败，请重新生成');
    await audit(c, actor.id, 'export_downloaded', id);
    return { body, sha256: row.sha256 };
}
