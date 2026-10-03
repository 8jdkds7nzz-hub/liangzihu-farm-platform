import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';import {AppError} from '../../platform/error';
import {choice} from '../../platform/validation';import {uuid} from '../identity/common';import {visible,payloadHash} from '../field/common';
import {lot,request,type Body} from '../inventory/common';
export async function traceLots(c:PoolClient,a:Actor,b:Body){
 const root=await lot(c,a,b.lotId,'read'),direction=choice(b.direction,['forward','backward'] as const,'追查方向');
 return request(c,a,b,'trace.query',root.object_id,async()=>{
 const auth=await visible(c,a,'stock_lot'),nodes=new Map<string,any>([[root.id,root]]),edges:any[]=[];let frontier=[root.id],boundary=false,truncated=false;
 const from=direction==='forward'?'input_lot_id':'output_lot_id',to=direction==='forward'?'output_lot_id':'input_lot_id';
 for(let depth=0;depth<20&&frontier.length;depth++){
 const rows=(await c.query(`SELECT e.id AS edge_id,e.input_lot_id,e.output_lot_id,e.transformation_id,e.document_id,l.* FROM stock_lineage e JOIN stock_lots l ON l.id=e.${to} WHERE e.${from}=ANY($1::uuid[]) ORDER BY e.id LIMIT 2001`,[frontier])).rows,next:string[]=[];
 if(rows.length>2000)truncated=true;
 for(const row of rows.slice(0,2000)){
 if(!auth.objects.includes(row.object_id)||(auth.resources&&!auth.resources.includes(row.id))){boundary=true;continue;}
 if(!nodes.has(row.id)){if(nodes.size>=500){truncated=true;continue;}const {edge_id,input_lot_id,output_lot_id,transformation_id,document_id,...node}=row;nodes.set(node.id,node);next.push(node.id);}
 if(!edges.some(e=>e.id===row.edge_id))edges.push({id:row.edge_id,from:row.input_lot_id,to:row.output_lot_id,transformationId:row.transformation_id,documentId:row.document_id});
 }
 frontier=next;if(depth===19&&next.length)truncated=true;
 }
 const ids=[...nodes.keys()],packages=(await c.query('SELECT e.*,p.code AS package_code FROM stock_package_events e JOIN stock_packages p ON p.id=e.package_id WHERE e.lot_id=ANY($1::uuid[]) ORDER BY e.created_at LIMIT 2001',[ids])).rows,handoffs=(await c.query('SELECT * FROM stock_handoffs WHERE lot_id=ANY($1::uuid[]) ORDER BY created_at LIMIT 2001',[ids])).rows;
 if(packages.length>2000||handoffs.length>2000)truncated=true;
 const snapshot={direction,nodes:[...nodes.values()],edges,packages:packages.slice(0,2000),handoffs:handoffs.slice(0,2000),boundary,truncated,complete:false,limitations:['查询到已录入且当前授权的批次关系；无关系不代表资料完整','最多20层、500节点、每层2000条关系，包装和交接各最多2000条',...(boundary?['存在未授权边界，未公开对象信息']:[]),...(truncated?['达到查询范围上限，请分批追查']:[])]};
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['trace:'+a.id+':'+root.id+':'+direction]);
 const version=Number((await c.query('SELECT COALESCE(max(version),0)+1 AS n FROM trace_queries WHERE created_by=$1 AND root_lot_id=$2 AND direction=$3',[a.id,root.id,direction])).rows[0].n);
 return(await c.query('INSERT INTO trace_queries(object_id,root_lot_id,direction,version,snapshot,input_hash,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[root.object_id,root.id,direction,version,snapshot,payloadHash(snapshot),a.id])).rows[0];
 });
}
export async function readTrace(c:PoolClient,a:Actor,id:string){
 uuid(id);const r=(await c.query('SELECT * FROM trace_queries WHERE id=$1',[id])).rows[0];if(!r)throw new AppError(404,'TRACE_NOT_FOUND','追查记录不存在');
 for(const n of r.snapshot.nodes)await lot(c,a,n.id,'read');
 return r;
}

