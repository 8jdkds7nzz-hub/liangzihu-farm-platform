import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';import {AppError} from '../../platform/error';import {text} from '../../platform/validation';import {payloadHash,sameHash} from '../field/common';import {access,request,type Body} from '../inventory/common';import {recordExecution} from './executions';
export async function importExecutions(c:PoolClient,a:Actor,b:Body){
 await access(c,a,b.objectId);if(!Array.isArray(b.rows)||!b.rows.length||b.rows.length>100||Buffer.byteLength(JSON.stringify(b.rows))>1024*1024)throw new AppError(413,'IMPORT_LIMIT','每次导入1至100行，内容不超过1MiB');
 return request(c,a,b,'protection.import',b.objectId as string,async()=>{
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['protection-import-object:'+b.objectId]);
 const result=[];for(let i=0;i<(b.rows as any[]).length;i++){const row=(b.rows as any[])[i];await c.query('SAVEPOINT protection_row');try{
 const id=text(row?.externalId,'外部作业记录号',120),source=text(b.sourceRef,'导入来源',200),plan=(await c.query('SELECT object_id FROM protection_plans WHERE id=$1',[row.planId])).rows[0];if(plan?.object_id!==b.objectId)throw new AppError(422,'PROTECTION_SCOPE','本行计划不属于本次导入对象');
 const hash=payloadHash(row);await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['protection-import:'+b.objectId+':'+source+':'+id]);
 let known=(await c.query('SELECT * FROM protection_import_keys WHERE object_id=$1 AND source_ref=$2 AND external_id=$3',[b.objectId,source,id])).rows[0];
 if(!known){
 const legacy=(await c.query(`SELECT DISTINCT src.body AS input,(p.result_rows -> (src.n::int - 1)) ->> 'id' AS execution_id
 FROM protection_imports p CROSS JOIN LATERAL jsonb_array_elements(p.input_rows) WITH ORDINALITY AS src(body,n)
 WHERE p.object_id=$1 AND p.source_ref=$2 AND src.body->>'externalId'=$3 AND (p.result_rows -> (src.n::int - 1))->>'ok'='true' LIMIT 3`,[b.objectId,source,id])).rows;
 if(new Set(legacy.map(r=>r.execution_id)).size>1)throw new AppError(409,'LEGACY_IMPORT_CONFLICT','历史同号作业存在多条执行记录，请人工核对，未自动覆盖或删除');
 if(legacy.length){for(const prior of legacy)sameHash(payloadHash(prior.input),hash);const existing=(await c.query('SELECT id FROM protection_executions WHERE id=$1 AND object_id=$2',[legacy[0].execution_id,b.objectId])).rows[0];if(!existing)throw new AppError(409,'LEGACY_IMPORT_CONFLICT','历史导入关系不完整，请核对原始资料');known={input_hash:hash,execution_id:existing.id};}
 if(!known){const data=await recordExecution(c,a,{...row,requestKey:'offline:'+payloadHash({source,id})});known={input_hash:hash,execution_id:data.id};}
 await c.query('INSERT INTO protection_import_keys(object_id,source_ref,external_id,input_hash,execution_id,created_by) VALUES($1,$2,$3,$4,$5,$6)',[b.objectId,source,id,hash,known.execution_id,a.id]);
 }
 sameHash(known.input_hash,hash);result.push({row:i+1,ok:true,id:known.execution_id});
 }catch(e){await c.query('ROLLBACK TO SAVEPOINT protection_row');result.push({row:i+1,ok:false,code:e instanceof AppError?e.code:'IMPORT_ROW_INVALID',message:e instanceof AppError?e.message:'行格式或关联资料无效'});}finally{await c.query('RELEASE SAVEPOINT protection_row');}}
 const r=(await c.query('INSERT INTO protection_imports(object_id,source_ref,input_hash,input_rows,result_rows,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[b.objectId,text(b.sourceRef,'导入来源',200),payloadHash(b.rows),JSON.stringify(b.rows),JSON.stringify(result),a.id])).rows[0];return {id:r.id,rows:result};
 });
}
