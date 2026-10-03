import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';import {access,exportTables} from '../phase4/common';import {stockOverview,exportStock} from '../inventory/queries';
import {AppError} from '../../platform/error';
export const circularTables=['circular_batches','circular_weighings','circular_processes'] as const;
export async function circularOverview(c:PoolClient,a:Actor,objectId:string){await access(c,a,objectId,'read');const stock=await stockOverview(c,a,objectId);return {...stock,
 batches:(await c.query('SELECT b.*,l.code,l.product,l.unit,l.basis,l.state FROM circular_batches b JOIN stock_lots l ON l.id=b.lot_id WHERE b.object_id=$1 ORDER BY b.created_at DESC,b.id LIMIT 200',[objectId])).rows,
 weighings:(await c.query('SELECT * FROM circular_weighings WHERE object_id=$1 ORDER BY created_at DESC,id LIMIT 200',[objectId])).rows,
 processes:(await c.query('SELECT p.*,d.metadata FROM circular_processes p JOIN stock_documents d ON d.id=p.document_id WHERE p.object_id=$1 ORDER BY p.created_at DESC,p.id LIMIT 200',[objectId])).rows};}
export async function exportCircular(c:PoolClient,a:Actor,id:string){const result={circular:await exportTables(c,a,id,circularTables),stock:await exportStock(c,a,id)};if(Buffer.byteLength(JSON.stringify(result))>8*1024*1024)throw new AppError(413,'EXPORT_LIMIT','合并导出超过8MiB，请使用管理员完整备份');return result;}
