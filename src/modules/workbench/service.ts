import type {PoolClient} from 'pg';
import type {Actor} from '../../platform/types';
import {visible} from '../field/common';

export async function workbench(c:PoolClient,a:Actor){
  const tasks=await visible(c,a,'task'),alerts=await visible(c,a,'alert'),briefings=await visible(c,a,'briefing_item');
  const taskRows=(await c.query(`SELECT t.id,t.object_id,o.name AS object_name,t.title,t.state,t.due_at FROM field_tasks t JOIN objects o ON o.id=t.object_id
    WHERE t.object_id=ANY($1::uuid[]) AND($2::uuid[] IS NULL OR t.id=ANY($2)) AND t.state NOT IN('reviewed','cancelled')
    AND($3::text<>'worker' OR t.assignee_id=$4 OR t.claimed_by=$4) ORDER BY t.due_at NULLS LAST,t.created_at LIMIT 20`,[tasks.objects,tasks.resources,a.role,a.id])).rows;
  const alertRows=(await c.query(`SELECT x.id,x.object_id,o.name AS object_name,x.title,x.severity,x.state,x.opened_at FROM alerts x JOIN objects o ON o.id=x.object_id
    WHERE x.object_id=ANY($1::uuid[]) AND($2::uuid[] IS NULL OR x.id=ANY($2)) AND x.state<>'closed' ORDER BY CASE WHEN x.severity='severe' THEN 0 ELSE 1 END,x.opened_at DESC LIMIT 20`,[alerts.objects,alerts.resources])).rows;
  const reviewCount=Number((await c.query("SELECT count(*) FROM briefing_items WHERE object_id=ANY($1::uuid[]) AND($2::uuid[] IS NULL OR id=ANY($2)) AND decision='draft'",[briefings.objects,briefings.resources])).rows[0].count);
  return {role:a.role,tasks:taskRows,alerts:alertRows,briefingsAwaitingReview:reviewCount,objectCount:tasks.objects.length,limits:'待办按当前权限最多列出20条；任务和告警不表示现场已接管',checkedAt:new Date().toISOString()};
}
