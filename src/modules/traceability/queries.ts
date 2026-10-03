import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';import {uuid} from '../identity/common';import {scope} from '../field/common';
import {showQuality} from '../inventory/queries';
import {caseStatus} from './cases';
export async function qualityOverview(c:PoolClient,a:Actor,objectId:string){
 uuid(objectId);await scope(c,a,objectId,'read');const result:Record<string,any>={limit:200};
 const tables={lots:'stock_lots',samples:'quality_samples',tests:'quality_tests',credentials:'quality_credentials',decisions:'quality_decisions',cases:'quality_cases',cards:'public_trace_cards'};
 for(const [name,table] of Object.entries(tables))result[name]=(await c.query('SELECT * FROM '+table+' WHERE object_id=$1 ORDER BY created_at DESC,id LIMIT 200',[objectId])).rows;
 result.lots=await showQuality(c,result.lots);
 result.cases=await Promise.all(result.cases.map((r:any)=>caseStatus(c,r.id)));
 result.queries=(await c.query('SELECT id,root_lot_id,direction,version,created_at FROM trace_queries WHERE object_id=$1 ORDER BY created_at DESC LIMIT 200',[objectId])).rows;
 return result;
}

