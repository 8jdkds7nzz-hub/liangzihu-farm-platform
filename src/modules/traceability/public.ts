import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';import {randomBytes} from 'node:crypto';
import {AppError} from '../../platform/error';import {text,time,choice} from '../../platform/validation';import {uuid} from '../identity/common';import {scope,arrayIds} from '../field/common';
import {lot,request,type Body} from '../inventory/common';import {assertLotReleased,credentialsCurrent} from './quality';
const notFound=()=>new AppError(404,'PUBLIC_TRACE_UNAVAILABLE','该查询页尚未发布、已到期或已撤回');
export function publicContent(value:unknown){
 if(!value||Array.isArray(value)||typeof value!=='object')throw new AppError(400,'PUBLIC_FIELDS','请填写客户可见字段');
 const input=value as Body,keys=['productName','batchLabel','province','city','county','harvestMonth','productionSummary','testSummary','limitations'];
 if(Object.keys(input).some(k=>!keys.includes(k)))throw new AppError(400,'PUBLIC_FIELDS','客户页只接受已定义的公开字段');
 const result:Record<string,string>={granularity:'批次级'};
 for(const key of keys){const val=text(input[key],key,['productionSummary','testSummary','limitations'].includes(key)?1000:120);
 if(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|https?:\/\/|\b\d{1,3}\.\d{3,}\s*[,，/]\s*\d{1,3}\.\d{3,}\b/i.test(val))throw new AppError(400,'PUBLIC_PRIVATE_DATA','公开内容不能含内部ID、原件链接或精确坐标');
 if(['province','city','county'].includes(key)&&(/[0-9]/.test(val)||val.length>30))throw new AppError(400,'PUBLIC_LOCATION','产区只填写省市县，不填写地址和坐标');
 result[key]=val;}
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(result.harvestMonth))throw new AppError(400,'PUBLIC_MONTH','采收月份须为YYYY-MM');
 return result;
}
export async function draftCard(c:PoolClient,a:Actor,b:Body){
 const l=await lot(c,a,b.lotId);await scope(c,a,l.object_id,'share');
 return request(c,a,b,'trace.card',l.object_id,async()=>{
 await lot(c,a,l.id,'record',true);const content=publicContent(b.content),until=time(b.validUntil),credentials=arrayIds(b.credentialIds??[]);
 if(Date.parse(until)<=Date.now()||Date.parse(until)>Date.now()+366*86400000)throw new AppError(400,'PUBLIC_EXPIRY','客户页有效期须在未来一年内');
 if(content.productName!==l.product)throw new AppError(422,'PUBLIC_PRODUCT','客户页产品名称须与批次一致');
 await credentialsCurrent(c,l,credentials);
 const version=Number((await c.query('SELECT COALESCE(max(version),0)+1 AS n FROM public_trace_cards WHERE lot_id=$1',[l.id])).rows[0].n);
 return(await c.query('INSERT INTO public_trace_cards(object_id,lot_id,version,code,content,credential_ids,valid_until,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[l.object_id,l.id,version,randomBytes(24).toString('hex'),content,credentials,until,a.id])).rows[0];
 });
}
export async function reviewCard(c:PoolClient,a:Actor,b:Body){
 uuid(b.id);const original=(await c.query('SELECT * FROM public_trace_cards WHERE id=$1',[b.id])).rows[0];if(!original)throw notFound();
 await lot(c,a,original.lot_id,'review');await scope(c,a,original.object_id,'share');
 return request(c,a,b,'trace.card-review',original.object_id,async()=>{
 await lot(c,a,original.lot_id,'review',true);const card=(await c.query('SELECT * FROM public_trace_cards WHERE id=$1 FOR UPDATE',[b.id])).rows[0],action=choice(b.action,['approve','revoke'] as const,'客户页操作');
 if(action==='approve'){
 if(card.state!=='draft')throw new AppError(409,'CARD_STATE','仅草稿可发布，修订需创建新版本');
 if(card.created_by===a.id)throw new AppError(403,'INDEPENDENT_REVIEW','请另一名审核人员核对客户可见内容');
 if(+card.valid_until<=Date.now())throw notFound();
 const l=await assertLotReleased(c,card.lot_id);await credentialsCurrent(c,l,card.credential_ids);
 }
 return(await c.query('UPDATE public_trace_cards SET state=$2,reviewed_by=$3,reviewed_at=now(),review_note=$4 WHERE id=$1 RETURNING *',[card.id,action==='approve'?'approved':'revoked',a.id,text(b.evidence,'发布或撤回依据',2000)])).rows[0];
 });
}
export async function publicCard(c:PoolClient,code:string){
 if(!/^[a-f0-9]{48}$/.test(code))throw notFound();
 const card=(await c.query("SELECT * FROM public_trace_cards WHERE code=$1 AND state='approved' AND valid_until>clock_timestamp()",[code])).rows[0];if(!card)throw notFound();
 try{const l=await assertLotReleased(c,card.lot_id);await credentialsCurrent(c,l,card.credential_ids);}catch(e){if(e instanceof AppError)throw notFound();throw e;}
 return {content:card.content,version:card.version,reviewedAt:card.reviewed_at,validUntil:card.valid_until,checkedAt:new Date().toISOString()};
}

