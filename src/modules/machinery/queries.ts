import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';import {access,exportTables} from '../phase4/common';import {assertMachineAccepted} from './evidence';import {AppError} from '../../platform/error';
export const machineryTables=['machinery_contracts','machinery_contract_reviews','machinery_bindings','machinery_orders','machinery_evidence','machinery_reviews','machinery_imports','machinery_import_rows'] as const;
export async function machineryOverview(c:PoolClient,a:Actor,objectId:string){await access(c,a,objectId,'read');const result:Record<string,any>={limit:200,externalAdapter:'not_implemented_pending_contract'};
 for(const [key,table] of Object.entries({contracts:'machinery_contracts',bindings:'machinery_bindings',orders:'machinery_orders',evidence:'machinery_evidence',reviews:'machinery_reviews',imports:'machinery_imports'}))result[key]=(await c.query('SELECT * FROM '+table+' WHERE object_id=$1 ORDER BY created_at DESC,id LIMIT 200',[objectId])).rows;
 result.devices=(await c.query("SELECT id,name,verified FROM devices WHERE object_id=$1 AND kind<>'camera_channel' ORDER BY name,id LIMIT 200",[objectId])).rows;
 result.media=(await c.query("SELECT id,name FROM media_assets WHERE object_id=$1 AND ingest_state='complete' ORDER BY created_at DESC,id LIMIT 200",[objectId])).rows;
 for(const row of result.orders){try{await assertMachineAccepted(c,row.id);row.current_acceptance='当前证据有效';}catch(e){if(!(e instanceof AppError))throw e;row.current_acceptance=e.message;}}
 return result;
}
export const exportMachinery=(c:PoolClient,a:Actor,id:string)=>exportTables(c,a,id,machineryTables);
