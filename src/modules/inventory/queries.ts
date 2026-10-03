import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';
import {AppError} from '../../platform/error';import {scope} from '../field/common';import {uuid} from '../identity/common';
import {lot} from './common';
import {assertLotReleased} from '../traceability/quality';
export async function showQuality(c:PoolClient,rows:any[]){for(const row of rows){row.current_eligibility='未放行';if(row.state==='available'){try{await assertLotReleased(c,row.id);row.current_eligibility='当前依据有效';}catch(e){if(!(e instanceof AppError))throw e;row.current_eligibility='放行依据已失效，禁止使用';}}}return rows;}
export const inventoryTables={locations:'stock_locations',lots:'stock_lots',documents:'stock_documents',purchases:'input_purchases',applications:'input_applications',transformations:'stock_transformations',packages:'stock_packages',packageEvents:'stock_package_events',handoffs:'stock_handoffs'} as const;
export async function stockOverview(c:PoolClient,a:Actor,objectId:string){
 uuid(objectId);await scope(c,a,objectId,'read');
 const data:Record<string,any>={limit:200,objectId};
 for(const [key,table] of Object.entries(inventoryTables))data[key]=(await c.query('SELECT * FROM '+table+' WHERE object_id=$1 ORDER BY created_at DESC,id LIMIT 200',[objectId])).rows;
 data.lots=await showQuality(c,data.lots);
 data.balances=(await c.query(`SELECT l.id AS lot_id,l.code,l.product,l.unit,l.basis,w.id AS location_id,w.name AS location_name,sum(e.delta)::text AS quantity
 FROM stock_entries e JOIN stock_lots l ON l.id=e.lot_id JOIN stock_locations w ON w.id=e.location_id WHERE l.object_id=$1
 GROUP BY l.id,w.id ORDER BY l.code,w.code LIMIT 200`,[objectId])).rows;
 return data;
}
export async function stockDetail(c:PoolClient,a:Actor,id:string){
 const r=await lot(c,a,id,'read');
 const entries=(await c.query('SELECT e.*,d.kind,d.occurred_at,d.evidence,w.name AS location_name FROM stock_entries e JOIN stock_documents d ON d.id=e.document_id JOIN stock_locations w ON w.id=e.location_id WHERE e.lot_id=$1 ORDER BY d.created_at DESC LIMIT 200',[id])).rows;
 return {lot:r,entries,limit:200};
}
export async function exportStock(c:PoolClient,a:Actor,objectId:unknown){
 uuid(objectId);await scope(c,a,objectId,'read');await scope(c,a,objectId,'export');
 const result:Record<string,any>={schemaVersion:'phase3-stock-v1',objectId,exportedAt:new Date().toISOString(),tables:{}};
 for(const table of Object.values(inventoryTables)){const rows=(await c.query('SELECT * FROM '+table+' WHERE object_id=$1 ORDER BY id LIMIT 5001',[objectId])).rows;if(rows.length>5000)throw new AppError(413,'EXPORT_LIMIT','单表超过5000条，请使用管理员完整备份');result.tables[table]=rows;}
 for(const [table,sql] of Object.entries({stock_entries:'SELECT e.* FROM stock_entries e JOIN stock_documents d ON d.id=e.document_id WHERE d.object_id=$1',stock_lineage:'SELECT l.* FROM stock_lineage l JOIN stock_documents d ON d.id=l.document_id WHERE d.object_id=$1'})){const rows=(await c.query(sql+' LIMIT 5001',[objectId])).rows;if(rows.length>5000)throw new AppError(413,'EXPORT_LIMIT','关联记录超过5000条，请使用管理员完整备份');result.tables[table]=rows;}
 if(Buffer.byteLength(JSON.stringify(result))>8*1024*1024)throw new AppError(413,'EXPORT_LIMIT','导出超过8MiB，请使用管理员完整备份');return result;
}

