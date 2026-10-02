import type {PoolClient} from 'pg';
export interface FactRef{kind:string;id:string}
export async function sourcesActive(c:PoolClient,refs:FactRef[]):Promise<boolean>{
 for(const ref of refs){let row:any;
  switch(ref.kind){
   case 'metric':row=(await c.query('SELECT m.id FROM metric_results m JOIN metric_definitions d ON d.id=m.definition_id WHERE m.id=$1 AND d.approved_at IS NOT NULL AND d.retired_at IS NULL',[ref.id])).rows[0];break;
   case 'calendar':row=(await c.query('SELECT id FROM calendar_versions WHERE id=$1 AND approved_at IS NOT NULL AND retired_at IS NULL',[ref.id])).rows[0];break;
   case 'briefing_item':row=(await c.query('SELECT fact_refs,source_refs FROM briefing_items WHERE id=$1',[ref.id])).rows[0];if(row&&!await sourcesActive(c,[...row.fact_refs,...row.source_refs]))return false;break;
   case 'record':row=(await c.query('SELECT r.id FROM farm_records r WHERE r.id=$1 AND NOT EXISTS(SELECT 1 FROM farm_records n WHERE n.supersedes_id=r.id)',[ref.id])).rows[0];break;
   case 'maintenance':case 'manual_check':{const table=ref.kind==='maintenance'?'maintenance_records':'manual_checks';row=(await c.query('SELECT r.id FROM '+table+' r WHERE r.id=$1 AND NOT EXISTS(SELECT 1 FROM '+table+' n WHERE n.supersedes_id=r.id)',[ref.id])).rows[0];break;}
   case 'knowledge':row=(await c.query("SELECT id FROM knowledge_documents WHERE id=$1 AND state='approved'",[ref.id])).rows[0];break;
   default:{const tables:Record<string,string>={alert:'alerts',weather:'weather_records',task:'field_tasks',batch:'production_batches',maintenance:'maintenance_records',irrigation:'irrigation_entries',inspection:'inspection_reports'};if(!tables[ref.kind])return false;row=(await c.query('SELECT id FROM '+tables[ref.kind]+' WHERE id=$1',[ref.id])).rows[0];}
  }if(!row)return false;
 }return true;
}
