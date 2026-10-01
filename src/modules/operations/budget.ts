import type { PoolClient } from 'pg';
import type { Actor } from '../../platform/types';
import { AppError } from '../../platform/error';
import { finite, text, time } from '../../platform/validation';
import { assertAccess, listAccessibleObjects } from '../identity/access';
import { uuid } from '../identity/common';
export async function saveBudget(c: PoolClient, actor: Actor, b: Record<string, unknown>) {
    uuid(b.objectId);
    await assertAccess(c, actor, { objectId: b.objectId, action: 'configure', at: new Date().toISOString() });
    const month = text(b.month, '预算月份', 10);
    if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month))
        throw new AppError(400, 'INVALID_MONTH', '预算月份格式须为YYYY-MM-01');
    const amount = finite(b.limitAmount, '预算上限');
    if (amount <= 0)
        throw new AppError(400, 'INVALID_BUDGET', '预算上限须大于零');
    const row = (await c.query(`INSERT INTO budgets(object_id,category,month,limit_amount,source,configured_by) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(object_id,category,month) DO UPDATE SET limit_amount=excluded.limit_amount,source=excluded.source,configured_by=excluded.configured_by RETURNING id`, [b.objectId, text(b.category, '费用类别', 80), month, amount, text(b.source, '批准或账单依据', 2000), actor.id])).rows[0];
    await c.query("INSERT INTO audit_events(actor_id,event_type,target_id,details,occurred_at) VALUES($1,'budget_configured',$2,$3,clock_timestamp())", [actor.id,row.id,{objectId:b.objectId,month,category:b.category,limitAmount:amount,source:b.source}]);
    return row;
}
export async function recordUsage(c: PoolClient, b: {
    objectId: string;
    category: string;
    businessKey: string;
    occurredAt: string;
    units: number;
    amount: number | null;
    priceSource?: string;
}) {
    uuid(b.objectId);
    time(b.occurredAt);
    finite(b.units, '使用量');
    if (b.units < 0 || (b.amount !== null && (!Number.isFinite(b.amount) || b.amount < 0 || !b.priceSource)))
        throw new AppError(422, 'USAGE_EVIDENCE', '费用须有非负数值和账单/单价依据；未知保持空白');
    const r = await c.query(`INSERT INTO usage_events(object_id,category,business_key,occurred_at,units,amount,price_source) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(business_key) DO NOTHING RETURNING id`, [b.objectId, b.category, b.businessKey, b.occurredAt, b.units, b.amount, b.priceSource ?? null]);
    if (!r.rowCount) {
        const same = (await c.query('SELECT object_id=$2 AND category=$3 AND units=$4 AND amount IS NOT DISTINCT FROM $5::numeric AND price_source IS NOT DISTINCT FROM $6::text AS same FROM usage_events WHERE business_key=$1', [b.businessKey, b.objectId, b.category, b.units, b.amount, b.priceSource ?? null])).rows[0]?.same;
        if (!same)
            throw new AppError(409, 'USAGE_CONFLICT', '同一用量标识对应不同账单内容');
    }
    await refreshBudgetAlerts(c, b.objectId);
}
export async function refreshBudgetAlerts(c: PoolClient, objectId: string) {
    const statuses = await budgetRows(c, [objectId]);
    for (const b of statuses) {
        const level = b.at_limit ? 'limit' : b.at_eighty ? 'eighty_percent' : null;
        if (level)
            await c.query('INSERT INTO budget_alerts(budget_id,level,observed_at) VALUES($1,$2,clock_timestamp()) ON CONFLICT DO NOTHING', [b.id, level]);
    }
}
async function budgetRows(c: PoolClient, ids: string[]) {
    return (await c.query(`SELECT b.*,b.month::text AS month,COALESCE(sum(u.amount),0)::text AS known_amount,count(u.id) FILTER(WHERE u.amount IS NULL)::integer AS unknown_cost_count,
  COALESCE(sum(u.amount),0)>=b.limit_amount*0.8 AS at_eighty,COALESCE(sum(u.amount),0)>=b.limit_amount AS at_limit
  FROM budgets b LEFT JOIN usage_events u ON u.object_id=b.object_id AND u.category=b.category AND date_trunc('month',u.occurred_at AT TIME ZONE 'Asia/Shanghai')::date=b.month
  WHERE b.object_id=ANY($1::uuid[]) GROUP BY b.id ORDER BY b.month DESC`, [ids])).rows;
}
export async function listBudgets(c: PoolClient, actor: Actor) { const ids = await listAccessibleObjects(c, actor, 'configure'); return budgetRows(c, ids); }
export function budgetAllows(knownAmount: number, limit: number | null, category: string, severe: boolean): boolean {
    if (category === 'voice' && severe)
        return true;
    return limit === null || knownAmount < limit;
}
