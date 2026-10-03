import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';import {exportTables} from '../phase4/common';import {assertExpense} from './expenses';import {AppError} from '../../platform/error';
import {financeAccess} from './access';
export const financeTables=['business_expenses','expense_reviews','expense_payments','subsidy_claims','subsidy_expenses','subsidy_events'] as const;
export async function financeOverview(c:PoolClient,a:Actor,objectId:string){await financeAccess(c,a,objectId);const r:Record<string,any>={limit:200,currency:'CNY',externalPayments:false,externalSubmissions:false};
 for(const [name,table] of Object.entries({expenses:'business_expenses',payments:'expense_payments',claims:'subsidy_claims'}))r[name]=(await c.query('SELECT * FROM '+table+' WHERE object_id=$1 ORDER BY created_at DESC,id LIMIT 200',[objectId])).rows;
 for(const row of r.expenses){try{await assertExpense(c,row.id);row.current_eligibility='已独立核实';}catch(e){if(!(e instanceof AppError))throw e;row.current_eligibility=e.message;}}
 r.events=(await c.query(`SELECT e.*,CASE WHEN fix.id IS NOT NULL THEN fix.occurred_at ELSE e.occurred_at END AS effective_occurred_at,fix.id AS latest_correction_id FROM subsidy_events e LEFT JOIN LATERAL(SELECT id,occurred_at FROM subsidy_events WHERE corrects_id=e.id ORDER BY seq DESC LIMIT 1) fix ON true WHERE e.object_id=$1 ORDER BY e.seq DESC LIMIT 200`,[objectId])).rows;
 r.summary=(await c.query(`SELECT (SELECT count(*) FROM business_expenses e WHERE object_id=$1 AND NOT EXISTS(SELECT 1 FROM business_expenses n WHERE n.supersedes_id=e.id))::integer AS expense_count,
 (SELECT count(*) FROM business_expenses e WHERE object_id=$1 AND amount_cny IS NULL AND NOT EXISTS(SELECT 1 FROM business_expenses n WHERE n.supersedes_id=e.id))::integer AS unknown_amounts,
 (SELECT sum(amount_cny)::text FROM business_expenses e WHERE object_id=$1 AND NOT EXISTS(SELECT 1 FROM business_expenses n WHERE n.supersedes_id=e.id)) AS registered_cny,
 (SELECT sum(CASE WHEN direction='pay' THEN amount_cny ELSE -amount_cny END)::text FROM expense_payments WHERE object_id=$1) AS recorded_paid_cny`,[objectId])).rows[0];
 return r;
}
export async function exportFinance(c:PoolClient,a:Actor,id:string){await financeAccess(c,a,id,'export');return exportTables(c,a,id,financeTables);}
