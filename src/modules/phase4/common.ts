import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';
import {AppError} from '../../platform/error';import {scope} from '../field/common';import {uuid} from '../identity/common';import {time} from '../../platform/validation';
export {access,request,type Body} from '../inventory/common';
export function period(from:unknown,to:unknown,maxDays=366){const start=time(from),end=time(to);if(start>=end||Date.parse(end)-Date.parse(start)>maxDays*86400000)throw new AppError(422,'PERIOD_INVALID','时间范围须先后有效且不超过'+maxDays+'天');return {start,end};}
export function independent(a:Actor,creator:string){if(a.id===creator)throw new AppError(403,'INDEPENDENT_REVIEW','须由其他有审核权限的人员独立核实');}
export async function exportTables(c:PoolClient,a:Actor,objectId:string,tables:readonly string[]){
 uuid(objectId);await scope(c,a,objectId,'read');await scope(c,a,objectId,'export');const result:Record<string,unknown>={schemaVersion:'phase4-v1',objectId,exportedAt:new Date().toISOString()},data:Record<string,unknown>={};
 for(const table of tables){if(!/^[a-z_]+$/.test(table))throw new Error('invalid internal table');const rows=(await c.query('SELECT * FROM '+table+' WHERE object_id=$1 ORDER BY id LIMIT 5001',[objectId])).rows;if(rows.length>5000)throw new AppError(413,'EXPORT_LIMIT','记录超过5000条，请使用管理员完整备份');data[table]=rows;}
 result.tables=data;if(Buffer.byteLength(JSON.stringify(result))>8*1024*1024)throw new AppError(413,'EXPORT_LIMIT','导出超过8MiB，请使用管理员完整备份');return result;
}
