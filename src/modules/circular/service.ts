import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';import {AppError} from '../../platform/error';import {text,time,choice} from '../../platform/validation';
import {access,request,type Body} from '../phase4/common';import {lot} from '../inventory/common';import {quantity,positive,micros,decimal} from '../inventory/quantity';import {postMovement} from '../inventory/ledger';import {transformStock} from '../inventory/transforms';
import {payloadHash} from '../field/common';
export async function registerCircularBatch(c:PoolClient,a:Actor,b:Body){const l=await lot(c,a,b.lotId);return request(c,a,b,'circular.batch',l.object_id,async()=>{if(l.unit!=='kg')throw new AppError(422,'CIRCULAR_UNIT','循环称量批次须使用kg并登记鲜干基');return(await c.query('INSERT INTO circular_batches(object_id,lot_id,material_kind,origin_ref,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *',[l.object_id,l.id,choice(b.materialKind,['silt','manure','straw','mushroom','compost','other'] as const,'物料类别'),text(b.originRef,'来源批与用途依据',4000),a.id])).rows[0];});}
export async function receiveCircularMaterial(c:PoolClient,a:Actor,b:Body){const l=await lot(c,a,b.lotId);return request(c,a,b,'circular.receive',l.object_id,async()=>{
 if(!(await c.query('SELECT 1 FROM circular_batches WHERE lot_id=$1',[l.id])).rowCount)throw new AppError(422,'CIRCULAR_BATCH','须先登记循环物料批次');
 const gross=positive(b.grossKg),tare=quantity(b.tareKg),net=positive(b.netKg),basis=choice(b.basis,['wet','dry','as_is'] as const,'称量口径'),moisture=b.moisturePct==null||b.moisturePct===''?null:quantity(b.moisturePct);
 if(micros(gross)-micros(tare)!==micros(net))throw new AppError(422,'WEIGHING_BALANCE','净重须等于毛重减皮重');
 if(basis!==l.basis||moisture!==null&&micros(moisture)>100000000n)throw new AppError(422,'WEIGHING_BASIS','鲜干基不符或含水率不在0至100');
 const dry=basis==='dry'?net:moisture===null?null:decimal(micros(net)*(100000000n-micros(moisture))/100000000n),voucher=text(b.voucher,'称量凭证号',200),evidence=text(b.evidence,'称量与来源依据',4000),at=time(b.occurredAt);
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['circular-voucher:'+l.object_id+':'+voucher]);
 const old=(await c.query('SELECT 1 FROM circular_weighings WHERE object_id=$1 AND voucher=$2',[l.object_id,voucher])).rowCount;if(old)throw new AppError(409,'WEIGHING_VOUCHER','该对象称量凭证已登记，不重复入库');
 const doc=await postMovement(c,a,{objectId:l.object_id,kind:'receipt',lotId:l.id,locationId:b.locationId,quantity:net,occurredAt:at,evidence,requestKey:'circular:'+payloadHash(b.requestKey)});
 const row=(await c.query('INSERT INTO circular_weighings(object_id,lot_id,document_id,gross_kg,tare_kg,net_kg,moisture_pct,dry_kg,basis,voucher,occurred_at,evidence,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',[l.object_id,l.id,doc.id,gross,tare,net,moisture,dry,basis,voucher,at,evidence,a.id])).rows[0];return {...row,dryKg:dry};
 });}
export async function processCircularMaterial(c:PoolClient,a:Actor,b:Body){await access(c,a,b.objectId);return request(c,a,b,'circular.process',b.objectId as string,async()=>{
 if(!Array.isArray(b.inputs)||!Array.isArray(b.outputs)||!b.inputs.length||!b.outputs.length||b.inputs.length>20||b.outputs.length>20)throw new AppError(400,'CIRCULAR_LINES','输入输出各1至20行');
 for(const x of [...b.inputs,...b.outputs]){const l=await lot(c,a,x?.lotId,'read');if(l.object_id!==b.objectId||!(await c.query('SELECT 1 FROM circular_batches WHERE lot_id=$1',[l.id])).rowCount)throw new AppError(422,'CIRCULAR_BATCH','处理行须为当前对象的循环物料批次');}
 const doc=await transformStock(c,a,{...b,kind:'processing',requestKey:'circular:'+payloadHash(b.requestKey)});
 const row=(await c.query('INSERT INTO circular_processes(object_id,document_id,process_kind,evidence,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *',[b.objectId,doc.id,choice(b.processKind,['treatment','screening','rework'] as const,'处理类型'),text(b.evidence,'处理依据',4000),a.id])).rows[0];return {...row,difference:doc.difference,comparable:doc.comparable};
 });}
