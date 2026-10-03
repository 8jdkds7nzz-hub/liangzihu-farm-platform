import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';import {AppError} from '../../platform/error';
const phase3Tables=['stock_locations','stock_lots','stock_documents','input_purchases','input_applications','stock_transformations','stock_packages','stock_package_events','stock_handoffs','quality_samples','quality_tests','quality_credentials','quality_decisions','quality_cases','quality_case_events','public_trace_cards','protection_plans','prescription_maps','prescription_events','protection_executions','protection_imports','protection_deliveries','protection_followups','crop_analyses','crop_labels','crop_schedules','crop_capture_runs','spectral_products','agronomy_notices','flow_observations','control_profiles','control_rules','control_requests','control_feedback','control_takeovers','protection_import_keys'] as const;
const resourceTables=['energy_meters','energy_meter_reviews','energy_readings','circular_batches','circular_weighings','circular_processes','machinery_contracts','machinery_contract_reviews','machinery_bindings','machinery_orders','machinery_evidence','machinery_reviews','machinery_imports','machinery_import_rows'] as const;
const financeTables=['business_expenses','expense_reviews','expense_payments','subsidy_claims','subsidy_expenses','subsidy_events','management_reports'] as const;
export async function exportBusinessRelations(c:PoolClient,a:Actor,ids:string[]){
 async function rows(sql:string,args:unknown[]= [ids]){const result=(await c.query(sql+' LIMIT 5001',args)).rows;if(result.length>5000)throw new AppError(422,'EXPORT_TOO_LARGE','业务关系超过单表5000条，请分对象导出或使用管理员完整备份');return result.map(r=>{const {execution_token,auth_version,request_key,...data}=r;return data;});}
 const phase3:Record<string,any>={},phase4:Record<string,any>={schemaVersion:'4c-v1',financeIncluded:['owner','technician','admin'].includes(a.role)},notices:string[]=[];
 for(const table of phase3Tables)phase3[table]=await rows('SELECT * FROM '+table+' WHERE object_id=ANY($1::uuid[]) ORDER BY id');
 phase3.stock_entries=await rows('SELECT e.* FROM stock_entries e JOIN stock_documents d ON d.id=e.document_id WHERE d.object_id=ANY($1::uuid[]) ORDER BY e.id');
 phase3.stock_lineage=await rows('SELECT l.* FROM stock_lineage l JOIN stock_documents d ON d.id=l.document_id WHERE d.object_id=ANY($1::uuid[]) ORDER BY l.id');
 const traces=await rows('SELECT * FROM trace_queries WHERE object_id=ANY($1::uuid[]) ORDER BY id');phase3.trace_queries=traces.filter(r=>r.snapshot.nodes.every((n:any)=>ids.includes(n.object_id)));if(phase3.trace_queries.length!==traces.length)notices.push('跨出本次对象范围的追查快照未包含，请显式选择全部相关对象');
 for(const table of resourceTables)phase4[table]=await rows('SELECT * FROM '+table+' WHERE object_id=ANY($1::uuid[]) ORDER BY id');
 if(phase4.financeIncluded)for(const table of financeTables)phase4[table]=await rows('SELECT * FROM '+table+' WHERE object_id=ANY($1::uuid[]) ORDER BY id');else notices.push('当前角色不含费用、补贴和经营报告导出权限，这些资料未包含');
 const protocols=await rows('SELECT * FROM research_protocols WHERE object_id=ANY($1::uuid[]) ORDER BY id'),included=protocols.filter(r=>r.plots.every((p:any)=>ids.includes(p.objectId))),pids=included.map(r=>r.id);phase4.research_protocols=included;
 if(protocols.length!==included.length)notices.push('试验协议的小区未全部包含在本次对象范围，对应协议、观察和结果未包含');
 for(const table of ['research_reviews','research_observations','research_results'])phase4[table]=await rows('SELECT * FROM '+table+' WHERE protocol_id=ANY($1::uuid[]) ORDER BY id',[pids]);
 phase4.research_result_reviews=await rows('SELECT * FROM research_result_reviews WHERE result_id=ANY($1::uuid[]) ORDER BY id',[phase4.research_results.map((r:any)=>r.id)]);
 return {phase3,phase4,businessScopeNotices:notices};
}
