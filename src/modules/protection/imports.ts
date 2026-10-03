import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';import {AppError} from '../../platform/error';import {text} from '../../platform/validation';import {payloadHash} from '../field/common';import {access,request,type Body} from '../inventory/common';import {recordExecution} from './executions';
export async function importExecutions(c:PoolClient,a:Actor,b:Body){
 await access(c,a,b.objectId);if(!Array.isArray(b.rows)||!b.rows.length||b.rows.length>100||Buffer.byteLength(JSON.stringify(b.rows))>1024*1024)throw new AppError(413,'IMPORT_LIMIT','每次导入1至100行，内容不超过1MiB');
 return request(c,a,b,'protection.import',b.objectId as string,async()=>{
 const result=[];for(let i=0;i<(b.rows as any[]).length;i++){const row=(b.rows as any[])[i];await c.query('SAVEPOINT protection_row');try{
 const id=text(row?.externalId,'外部作业记录号',120),source=text(b.sourceRef,'导入来源',200),plan=(await c.query('SELECT object_id FROM protection_plans WHERE id=$1',[row.planId])).rows[0];if(plan?.object_id!==b.objectId)throw new AppError(422,'PROTECTION_SCOPE','本行计划不属于本次导入对象');
 const data=await recordExecution(c,a,{...row,requestKey:'offline:'+payloadHash({source,id})});result.push({row:i+1,ok:true,id:data.id});
 }catch(e){await c.query('ROLLBACK TO SAVEPOINT protection_row');result.push({row:i+1,ok:false,code:e instanceof AppError?e.code:'IMPORT_ROW_INVALID',message:e instanceof AppError?e.message:'行格式或关联资料无效'});}finally{await c.query('RELEASE SAVEPOINT protection_row');}}
 const r=(await c.query('INSERT INTO protection_imports(object_id,source_ref,input_hash,input_rows,result_rows,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[b.objectId,text(b.sourceRef,'导入来源',200),payloadHash(b.rows),JSON.stringify(b.rows),JSON.stringify(result),a.id])).rows[0];return {id:r.id,rows:result};
 });
}

