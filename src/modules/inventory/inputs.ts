import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';
import {AppError} from '../../platform/error';import {text,time} from '../../platform/validation';import {uuid} from '../identity/common';
import {request,lot,type Body} from './common';import {positive,micros,signedMicros} from './quantity';
export async function recordPurchase(c:PoolClient,a:Actor,b:Body){
 const r=await lot(c,a,b.lotId);if(r.kind!=='input')throw new AppError(422,'LOT_KIND','投入品采购须引用投入品批次');
 return request(c,a,b,'purchase',r.object_id,async()=>(await c.query('INSERT INTO input_purchases(object_id,lot_id,supplier,voucher,quantity,occurred_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[r.object_id,r.id,text(b.supplier,'供应主体',200),text(b.voucher,'采购凭证',2000),positive(b.quantity,r.unit),time(b.occurredAt),a.id])).rows[0]);
}
export async function recordApplication(c:PoolClient,a:Actor,b:Body){
 const r=await lot(c,a,b.lotId);if(r.kind!=='input')throw new AppError(422,'LOT_KIND','施用须引用投入品批次');
 return request(c,a,b,'application',r.object_id,async()=>{
 await lot(c,a,r.id,'record',true);uuid(b.issueDocumentId);const d=(await c.query('SELECT * FROM stock_documents WHERE id=$1 FOR UPDATE',[b.issueDocumentId])).rows[0];
 if(!d||d.object_id!==r.object_id||d.kind!=='issue'||(await c.query('SELECT 1 FROM stock_documents WHERE reverses_id=$1',[d.id])).rowCount)throw new AppError(422,'ISSUE_REQUIRED','须关联本对象未冲销的领用单');
 const q=positive(b.quantity,r.unit),issued=(await c.query('SELECT COALESCE(-sum(delta),0)::text AS q FROM stock_entries WHERE document_id=$1 AND lot_id=$2',[d.id,r.id])).rows[0].q,used=(await c.query('SELECT COALESCE(sum(quantity),0)::text AS q FROM input_applications WHERE issue_document_id=$1 AND lot_id=$2',[d.id,r.id])).rows[0].q;
 if(micros(q)+signedMicros(used)>signedMicros(issued))throw new AppError(409,'APPLICATION_EXCEEDS_ISSUE','实际施用累计超过该批领用数量');
 const at=time(b.occurredAt);if(new Date(at)<d.occurred_at)throw new AppError(422,'APPLICATION_TIME','施用时间不能早于对应领用');
 if(b.farmRecordId){uuid(b.farmRecordId);if((await c.query('SELECT object_id FROM farm_records WHERE id=$1',[b.farmRecordId])).rows[0]?.object_id!==r.object_id)throw new AppError(422,'STOCK_SCOPE','农事记录不属于投入品使用对象');}
 return(await c.query('INSERT INTO input_applications(object_id,lot_id,issue_document_id,farm_record_id,quantity,occurred_at,evidence,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[r.object_id,r.id,d.id,b.farmRecordId||null,q,at,text(b.evidence,'施用依据',4000),a.id])).rows[0];
 });
}

