import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';
import {AppError} from '../../platform/error';import {choice,text,time} from '../../platform/validation';import {uuid} from '../identity/common';
import {access,request,lot,available,type Body} from './common';import {positive,micros,decimal,signedMicros} from './quantity';import {postDocument} from './ledger';
export async function packStock(c:PoolClient,a:Actor,b:Body){
 const r=await lot(c,a,b.lotId);await access(c,a,b.objectId);if(r.object_id!==b.objectId)throw new AppError(422,'STOCK_SCOPE','包装和批次不属于同一对象');
 return request(c,a,b,'package',r.object_id,async()=>{
 const code=text(b.code,'物流包装码',120),action=choice(b.action,['add','remove'] as const,'包装动作'),q=positive(b.quantity,r.unit);
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['stock-package:'+code]);
 let p=(await c.query('SELECT * FROM stock_packages WHERE code=$1',[code])).rows[0];
 if(p&&p.object_id!==r.object_id)throw new AppError(409,'PACKAGE_EXISTS','该包装码已在其他范围使用');
 if(!p){if(action==='remove')throw new AppError(409,'PACKAGE_EXCEEDS_BALANCE','包装尚无可拆出的记录');p=(await c.query('INSERT INTO stock_packages(object_id,code,created_by) VALUES($1,$2,$3) RETURNING *',[r.object_id,code,a.id])).rows[0];}
 const packed=(await c.query("SELECT COALESCE(sum(CASE WHEN action='add' THEN quantity ELSE -quantity END),0)::text AS q FROM stock_package_events WHERE package_id=$1 AND lot_id=$2",[p.id,r.id])).rows[0].q;
 if(action==='remove'&&micros(q)>signedMicros(packed))throw new AppError(409,'PACKAGE_EXCEEDS_BALANCE','拆分量超过该包装内已聚合数量');
 return(await c.query('INSERT INTO stock_package_events(object_id,package_id,lot_id,action,quantity,occurred_at,evidence,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[r.object_id,p.id,r.id,action,q,time(b.occurredAt),text(b.evidence,'包装依据',2000),a.id])).rows[0];
 });
}
export async function dispatchStatus(c:PoolClient,id:string){
 uuid(id);const d=(await c.query("SELECT * FROM stock_handoffs WHERE id=$1 AND direction='dispatch'",[id])).rows[0];
 if(!d)throw new AppError(404,'DISPATCH_NOT_FOUND','发货记录不存在');
 const received=(await c.query('SELECT COALESCE(sum(quantity),0)::text AS q FROM stock_handoffs WHERE dispatch_id=$1',[id])).rows[0].q;
 return {...d,received:decimal(signedMicros(received)),outstanding:decimal(micros(d.quantity)-signedMicros(received))};
}
export async function handoff(c:PoolClient,a:Actor,b:Body){
 const direction=choice(b.direction,['dispatch','receipt'] as const,'交接方向');
 let dispatch:any=null;if(direction==='receipt'){uuid(b.dispatchId);dispatch=(await c.query("SELECT * FROM stock_handoffs WHERE id=$1 AND direction='dispatch'",[b.dispatchId])).rows[0];if(!dispatch)throw new AppError(404,'DISPATCH_NOT_FOUND','须关联原发货记录');}
 const r=await lot(c,a,dispatch?.lot_id??b.lotId);
 return request(c,a,b,'handoff',r.object_id,async()=>{
 await lot(c,a,r.id,'record',true);const q=positive(b.quantity,r.unit),at=time(b.occurredAt),evidence=text(b.evidence,'交接依据',4000);let doc:any=null;
 if(direction==='dispatch'){await available(c,r);uuid(b.locationId);doc=await postDocument(c,a,{objectId:r.object_id,kind:'dispatch',occurredAt:at,evidence},[{lotId:r.id,locationId:b.locationId,delta:'-'+q}],{party:text(b.party,'发货主体',200)});}
 else{await c.query('SELECT id FROM stock_handoffs WHERE id=$1 FOR UPDATE',[dispatch.id]);const status=await dispatchStatus(c,dispatch.id);
 if(micros(q)>micros(status.outstanding))throw new AppError(409,'RECEIPT_EXCEEDS_DISPATCH','累计收货量不能超过发货量');
 if(new Date(at)<dispatch.occurred_at)throw new AppError(422,'HANDOFF_TIME','收货时间不能早于发货');}
 return(await c.query('INSERT INTO stock_handoffs(object_id,lot_id,dispatch_id,direction,party,quantity,occurred_at,evidence,document_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[r.object_id,r.id,dispatch?.id??null,direction,text(b.party,'交接主体',200),q,at,evidence,doc?.id??null,a.id])).rows[0];
 });
}

