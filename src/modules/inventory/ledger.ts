import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';
import {AppError} from '../../platform/error';import {choice,text,time,optionalText} from '../../platform/validation';import {uuid} from '../identity/common';
import {access,request,lot,location,available,type Body} from './common';import {positive,micros,decimal,signedMicros,quantity} from './quantity';
export type Entry={lotId:string;locationId:string;delta:string};
export async function balance(c:PoolClient,lotId:string,locationId:string){return decimal(signedMicros((await c.query('SELECT COALESCE(sum(delta),0)::text AS total FROM stock_entries WHERE lot_id=$1 AND location_id=$2',[lotId,locationId])).rows[0].total));}
export async function lockedLots(c:PoolClient,a:Actor,ids:string[],objectId:string){
 const rows=new Map<string,any>();for(const id of [...new Set(ids)].sort()){const r=await lot(c,a,id,'record',true);if(r.object_id!==objectId)throw new AppError(422,'STOCK_SCOPE','批次不属于当前对象');rows.set(id,r);}return rows;
}
export async function postDocument(c:PoolClient,a:Actor,b:Body,entries:Entry[],metadata:Body={},reversesId?:string){
 const combined=new Map<string,Entry>();
 for(const e of entries){await location(c,e.locationId,b.objectId as string);const k=e.lotId+'/'+e.locationId,old=combined.get(k);combined.set(k,{...e,delta:decimal(signedMicros(e.delta)+(old?signedMicros(old.delta):0n))});}
 for(const e of combined.values()){if(signedMicros(await balance(c,e.lotId,e.locationId))+signedMicros(e.delta)<0n)throw new AppError(409,'INSUFFICIENT_STOCK','当前仓位库存不足，整笔操作未过账');}
 const r=(await c.query('INSERT INTO stock_documents(object_id,kind,occurred_at,evidence,metadata,reverses_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[b.objectId,b.kind,time(b.occurredAt),text(b.evidence,'操作依据',4000),metadata,reversesId??null,a.id])).rows[0];
 for(const e of combined.values())if(e.delta!=='0')await c.query('INSERT INTO stock_entries(document_id,lot_id,location_id,delta) VALUES($1,$2,$3,$4)',[r.id,e.lotId,e.locationId,e.delta]);
 return r;
}
export async function postMovement(c:PoolClient,a:Actor,b:Body){
 await access(c,a,b.objectId);const kind=choice(b.kind,['receipt','harvest','issue','transfer','return','downgrade','adjust','reverse'] as const,'库存动作');
 if(['adjust','reverse','downgrade'].includes(kind))await access(c,a,b.objectId,'review');
 if(kind==='downgrade'){
  const original=await lot(c,a,b.lotId),target=await lot(c,a,b.targetLotId);
  if(original.unit!==target.unit||original.basis!==target.basis||original.id===target.id)throw new AppError(422,'STOCK_DOWNGRADE','降级须不同批次且数量单位口径一致');
  text(b.reason,'降级依据',2000);
  const {transformStock}=await import('./transforms');
  return transformStock(c,a,{...b,kind:'downgrade',code:text(b.conversionCode??('降级-'+text(b.requestKey,'提交标识',120)),'转换编号',160),inputs:[{lotId:b.lotId,locationId:b.locationId,quantity:b.quantity}],outputs:[{lotId:b.targetLotId,locationId:b.locationId,quantity:b.quantity}]});
 }
 return request(c,a,b,'movement',b.objectId as string,async()=>{
 if(kind==='reverse')return reverse(c,a,b);
 uuid(b.lotId);const ids=[b.lotId];
 const lots=await lockedLots(c,a,ids,b.objectId as string),r=lots.get(b.lotId),q=positive(b.quantity,r.unit);uuid(b.locationId);
 const metadata:Body={reason:optionalText(b.reason,'差异说明',2000),grossWeight:b.grossWeight==null||b.grossWeight===''?null:quantity(b.grossWeight),netWeight:b.netWeight==null||b.netWeight===''?null:quantity(b.netWeight),count:b.count==null||b.count===''?null:quantity(b.count,'piece'),moisture:b.moisture==null||b.moisture===''?null:quantity(b.moisture)};
 if(metadata.grossWeight!==null&&metadata.netWeight!==null&&micros(metadata.grossWeight)<micros(metadata.netWeight))throw new AppError(422,'WEIGHT_ORDER','毛重不得小于净重');
 if(metadata.moisture!==null&&micros(metadata.moisture)>100000000n)throw new AppError(422,'MOISTURE_RANGE','含水率须在0至100百分比');
 let delta=q;const entries:Entry[]=[];
 if(kind==='harvest'&&r.kind!=='harvest')throw new AppError(422,'LOT_KIND','采收仅能入采收批次');
 if((kind==='receipt'||kind==='harvest'||kind==='return'&&b.direction==='in')&&r.state!=='pending')throw new AppError(409,'RECEIPT_NOT_PENDING','新增收货或退入须使用待检批次，不能沿用旧放行结论');
 if(kind==='issue'){await available(c,r);delta='-'+q;}
 if(kind==='return'){const direction=choice(b.direction,['in','out'] as const,'退货方向');metadata.direction=direction;delta=direction==='out'?'-'+q:q;}
 if(kind==='adjust'){if(!metadata.reason)throw new AppError(400,'STOCK_DIFFERENCE_REASON','盘点调整须填写差异依据');delta=choice(b.direction,['in','out'] as const,'调整方向')==='out'?'-'+q:q;}
 if(kind==='transfer'){uuid(b.toLocationId);if(b.locationId===b.toLocationId)throw new AppError(400,'STOCK_TRANSFER_SAME','调拨仓位不能相同');delta='-'+q;entries.push({lotId:r.id,locationId:b.toLocationId,delta:q});}
 entries.push({lotId:r.id,locationId:b.locationId,delta});return postDocument(c,a,{...b,kind},entries,metadata);
 });
}
async function reverse(c:PoolClient,a:Actor,b:Body){
 uuid(b.reversesId);const d=(await c.query('SELECT * FROM stock_documents WHERE id=$1',[b.reversesId])).rows[0];
 if(!d||d.object_id!==b.objectId)throw new AppError(422,'STOCK_SCOPE','原单据不属于当前对象');
 const rows=(await c.query('SELECT * FROM stock_entries WHERE document_id=$1',[d.id])).rows;await lockedLots(c,a,rows.map(r=>r.lot_id),d.object_id);
 await c.query('SELECT id FROM stock_documents WHERE id=$1 FOR UPDATE',[d.id]);
 if(d.kind==='reverse'||(await c.query('SELECT 1 FROM stock_documents WHERE reverses_id=$1',[d.id])).rowCount)throw new AppError(409,'STOCK_ALREADY_REVERSED','原单据不能再次冲销');
 const used=(await c.query(`SELECT 1 FROM input_applications WHERE issue_document_id=$1
 UNION ALL SELECT 1 FROM stock_lineage WHERE document_id=$1
 UNION ALL SELECT 1 FROM stock_handoffs WHERE document_id=$1 LIMIT 1`,[d.id])).rowCount;
 if(used)throw new AppError(409,'STOCK_DEPENDENCIES','原单据已有施用、加工或交接依赖，不能直接冲销');
 return postDocument(c,a,{...b,kind:'reverse'},rows.map(r=>({lotId:r.lot_id,locationId:r.location_id,delta:decimal(-signedMicros(r.delta))})),{reason:text(b.reason??b.evidence,'冲销依据',2000)},d.id);
}
