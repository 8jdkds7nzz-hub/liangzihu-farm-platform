import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';
import {AppError} from '../../platform/error';import {text,time,choice,integer} from '../../platform/validation';import {uuid} from '../identity/common';import {scope,arrayIds} from '../field/common';
import {lot,request,type Body} from '../inventory/common';
const fail=()=>new AppError(409,'QUALITY_NOT_CURRENT','当前质量依据未通过、已过期或存在未结问题，请重新核查放行');
export async function recordSample(c:PoolClient,a:Actor,b:Body){
 const l=await lot(c,a,b.lotId);return request(c,a,b,'quality.sample',l.object_id,async()=>{
 const r=(await c.query('INSERT INTO quality_samples(object_id,lot_id,sample_code,stage,sampled_at,source,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING *',[l.object_id,l.id,text(b.sampleCode,'样品号',120),choice(b.stage,['raw','finished'] as const,'检测阶段'),time(b.sampledAt),text(b.source,'取样依据',2000),a.id])).rows[0];
 if(!r)throw new AppError(409,'SAMPLE_EXISTS','样品编号已登记');return r;});
}
export async function recordTest(c:PoolClient,a:Actor,b:Body){
 uuid(b.sampleId);const s=(await c.query('SELECT * FROM quality_samples WHERE id=$1',[b.sampleId])).rows[0];if(!s)throw new AppError(404,'SAMPLE_NOT_FOUND','样品不存在');
 const l=await lot(c,a,s.lot_id);return request(c,a,b,'quality.test',l.object_id,async()=>{
 await lot(c,a,l.id,'record',true);const at=time(b.testedAt),until=time(b.validUntil);
 if(until<=at||new Date(at)<s.sampled_at||Date.parse(at)>Date.now()+60000)throw new AppError(422,'TEST_PERIOD','检测须晚于取样、有效截止须晚于检测，不能记录未来检测');
 if(b.supersedesId){uuid(b.supersedesId);const old=(await c.query('SELECT * FROM quality_tests WHERE id=$1',[b.supersedesId])).rows[0];if(old?.sample_id!==s.id)throw new AppError(422,'TEST_CORRECTION_SCOPE','更正只能引用同一样品的检测');
 if(new Date(at)<old.tested_at||(await c.query('SELECT 1 FROM quality_tests WHERE supersedes_id=$1',[old.id])).rowCount)throw new AppError(409,'TEST_ALREADY_CORRECTED','原检测已更正或新检测时间早于原记录');}
 return(await c.query('INSERT INTO quality_tests(object_id,sample_id,method,result,report_ref,tested_at,valid_until,supersedes_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[l.object_id,s.id,text(b.method,'检测方法',1000),choice(b.result,['pass','fail','inconclusive'] as const,'结论'),text(b.reportRef,'报告及依据',4000),at,until,b.supersedesId||null,a.id])).rows[0];
 });
}
export async function recordCredential(c:PoolClient,a:Actor,b:Body){
 const l=await lot(c,a,b.lotId);if(b.verified===true)await scope(c,a,l.object_id,'review');
 return request(c,a,b,'quality.credential',l.object_id,async()=>{const from=time(b.validFrom),until=time(b.validUntil);if(until<=from)throw new AppError(422,'CREDENTIAL_PERIOD','凭证有效截止须晚于开始');
 return(await c.query('INSERT INTO quality_credentials(object_id,lot_id,kind,subject,product,valid_from,valid_until,evidence,verified,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[l.object_id,l.id,choice(b.kind,['certificate','certification','brand'] as const,'凭证类别'),text(b.subject,'凭证主体',200),text(b.product,'凭证产品',200),from,until,text(b.evidence,'核实依据',4000),b.verified===true,a.id])).rows[0];});
}
export async function credentialsCurrent(c:PoolClient,l:any,ids:string[]){
 if(!ids.length)return;const rows=(await c.query('SELECT * FROM quality_credentials WHERE id=ANY($1::uuid[])',[ids])).rows,now=Date.now();
 if(rows.length!==ids.length||rows.some(r=>r.lot_id!==l.id||r.product!==l.product||!r.verified||+r.valid_from>now||+r.valid_until<=now))throw fail();
}
async function evidenceCurrent(c:PoolClient,l:any,testIds:string[],credentialIds:string[]){
 if(!testIds.length)throw fail();
 const selected=(await c.query(`SELECT t.*,s.stage,s.lot_id FROM quality_tests t JOIN quality_samples s ON s.id=t.sample_id
 WHERE t.id=ANY($1::uuid[]) AND NOT EXISTS(SELECT 1 FROM quality_tests newer WHERE newer.supersedes_id=t.id)`,[testIds])).rows;
 const stage=l.kind==='processed'?'finished':'raw',now=Date.now();
 if(selected.length!==testIds.length||selected.some(t=>t.lot_id!==l.id||t.stage!==stage||t.result!=='pass'||+t.valid_until<=now||+t.tested_at>now))throw fail();
 const faults=(await c.query(`SELECT 1 FROM quality_tests t JOIN quality_samples s ON s.id=t.sample_id WHERE s.lot_id=$1 AND t.result<>'pass'
 AND NOT EXISTS(SELECT 1 FROM quality_tests n WHERE n.supersedes_id=t.id) LIMIT 1`,[l.id])).rowCount;
 if(faults||(await c.query("SELECT 1 FROM quality_cases WHERE lot_id=$1 AND state='open' LIMIT 1",[l.id])).rowCount)throw fail();
 await credentialsCurrent(c,l,credentialIds);
}
export async function assertLotReleased(c:PoolClient,id:string){
 const l=(await c.query('SELECT * FROM stock_lots WHERE id=$1',[id])).rows[0];if(!l||l.state!=='available')throw new AppError(409,'LOT_NOT_RELEASED','批次尚未审核可用或已经限制');
 const d=(await c.query("SELECT * FROM quality_decisions WHERE lot_id=$1 AND version=$2 AND to_state='available'",[id,l.version])).rows[0];if(!d)throw fail();await evidenceCurrent(c,l,d.test_ids,d.credential_ids);return l;
}
export async function decideQuality(c:PoolClient,a:Actor,b:Body){
 const original=await lot(c,a,b.lotId,'review');return request(c,a,b,'quality.decision',original.object_id,async()=>{
 const l=await lot(c,a,original.id,'review',true);if(integer(b.expectedVersion,'批次版本')!==l.version)throw new AppError(409,'QUALITY_VERSION','批次质量状态已改变，请重新核对');
 const state=choice(b.toState,['pending','available','returned','recalled','blocked'] as const,'目标状态'),tests=arrayIds(b.testIds??[]),credentials=arrayIds(b.credentialIds??[]);
 if(state==='available'){if(a.id===l.created_by)throw new AppError(403,'INDEPENDENT_REVIEW','批次创建者不能自行放行，请另一名审核人员核查');await evidenceCurrent(c,l,tests,credentials);}
 const r=(await c.query('INSERT INTO quality_decisions(object_id,lot_id,from_state,to_state,version,test_ids,credential_ids,evidence,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[l.object_id,l.id,l.state,state,l.version+1,tests,credentials,text(b.evidence,'审核依据',4000),a.id])).rows[0];
 await c.query('UPDATE stock_lots SET state=$2,version=version+1 WHERE id=$1',[l.id,state]);return r;
 });
}

