import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';
import {AppError} from '../../platform/error';import {text,choice,optionalText} from '../../platform/validation';import {uuid} from '../identity/common';
import {access,request,available,type Body} from './common';import {positive,micros,decimal} from './quantity';import {lockedLots,postDocument,type Entry} from './ledger';
function lines(v:unknown){if(!Array.isArray(v)||!v.length||v.length>20)throw new AppError(400,'TRANSFORM_LINES','加工输入和输出各须1至20行');return v.map((x:any)=>{uuid(x?.lotId);uuid(x?.locationId);return {lotId:x.lotId as string,locationId:x.locationId as string,quantity:x.quantity};});}
export async function transformStock(c:PoolClient,a:Actor,b:Body){
 await access(c,a,b.objectId);return request(c,a,b,'transform',b.objectId as string,async()=>{
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['stock-graph:'+b.objectId]);
 const input=lines(b.inputs),output=lines(b.outputs),all=[...input,...output];
 if(new Set(all.map(x=>x.lotId)).size!==all.length)throw new AppError(422,'TRANSFORM_DUPLICATE','同一步骤不能重复或同时输入输出同一批次');
 const rows=await lockedLots(c,a,all.map(x=>x.lotId),b.objectId as string),entries:Entry[]=[];
 for(const x of all)x.quantity=positive(x.quantity,rows.get(x.lotId).unit);
 for(const x of input){await available(c,rows.get(x.lotId));entries.push({lotId:x.lotId,locationId:x.locationId,delta:'-'+x.quantity});}
 for(const x of output){if(rows.get(x.lotId).state!=='pending')throw new AppError(409,'OUTPUT_NOT_PENDING','加工输出须为待检批次，已放行批次不能追加新加工产出');entries.push({lotId:x.lotId,locationId:x.locationId,delta:x.quantity});}
 for(const x of output)for(const y of input){
 const cycle=(await c.query(`WITH RECURSIVE reach(id) AS (SELECT output_lot_id FROM stock_lineage WHERE input_lot_id=$1 UNION SELECT l.output_lot_id FROM stock_lineage l JOIN reach r ON l.input_lot_id=r.id) SELECT 1 FROM reach WHERE id=$2 LIMIT 1`,[x.lotId,y.lotId])).rowCount;
 if(cycle)throw new AppError(422,'STOCK_LINEAGE_CYCLE','加工关系会形成批次循环，请新建独立输出批次');
 }
 const comparable=new Set(all.map(x=>rows.get(x.lotId).unit+'/'+rows.get(x.lotId).basis)).size===1;
 const difference=comparable?decimal(input.reduce((n,x)=>n+micros(x.quantity),0n)-output.reduce((n,x)=>n+micros(x.quantity),0n)):null,reason=optionalText(b.reason,'差异依据',4000);
 if((difference===null||difference!=='0')&&!reason)throw new AppError(422,'STOCK_DIFFERENCE_REASON','数量差异或不同口径须记录原因及计量依据');
 if(difference===null||difference!=='0')await access(c,a,b.objectId,'review');
 const code=text(b.code,'转换编号',120),kind=choice(b.kind,['processing','downgrade'] as const,'转换类型'),evidence=text(b.evidence,'加工依据',4000);
 let transformation=(await c.query('SELECT * FROM stock_transformations WHERE object_id=$1 AND code=$2',[b.objectId,code])).rows[0];
 if(transformation&&transformation.kind!==kind)throw new AppError(409,'TRANSFORM_IDENTITY','原转换编号的类型不能改变');
 if(!transformation)transformation=(await c.query('INSERT INTO stock_transformations(object_id,code,kind,source_ref,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *',[b.objectId,code,kind,evidence,a.id])).rows[0];
 const doc=await postDocument(c,a,{...b,kind:'transformation'},entries,{transformationId:transformation.id,comparable,difference,reason,unit:comparable?rows.get(input[0].lotId).unit:null,basis:comparable?rows.get(input[0].lotId).basis:null});
 for(const x of input)for(const y of output)await c.query('INSERT INTO stock_lineage(transformation_id,document_id,input_lot_id,output_lot_id) VALUES($1,$2,$3,$4)',[transformation.id,doc.id,x.lotId,y.lotId]);
 return {...doc,transformationId:transformation.id,comparable,difference};
 });
}

