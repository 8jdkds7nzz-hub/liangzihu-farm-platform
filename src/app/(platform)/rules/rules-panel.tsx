'use client';
import { useApi } from '@/components/platform/use-api';
import ActionForm from '@/components/platform/action-form';
import { Field, Pick, type Option } from '@/components/platform/fields';
type Rule = {
    id: string;
    binding_id: string;
    name: string;
    version: number;
    object_id: string;
    metric: string;
    unit: string;
    threshold: string;
    approved_at: string | null;
    enabled: boolean;
    active_version_id: string | null;
    source: string;
};
export default function RulesPanel() {
    const me = useApi<{
        scopes: {
            action: string;
            objectIds: string[];
        }[];
    }>('/api/v1/me'), objects = useApi<{
        items: Option[];
    }>('/api/v1/objects?limit=200'), points = useApi<Option[]>('/api/v1/points'), batches = useApi<(Option & {
        verified: boolean;
    })[]>('/api/v1/batches'), rules = useApi<Rule[]>('/api/v1/rules');
    const error = me.error || objects.error || points.error || batches.error || rules.error;
    if (error)
        return <p className="form-error">{error}</p>;
    if (!me.data || !objects.data || !points.data || !batches.data || !rules.data)
        return <p>正在加载规则…</p>;
    const can = (action: string, id: string) => me.data!.scopes.some(s => s.action === action && s.objectIds.includes(id)), config = objects.data.items.filter(o => can('configure', o.id));
    const saved = () => void rules.reload();
    return <>{!!config.length && <details><summary>登记规则草稿</summary><ActionForm path="/api/v1/rules" numbers={['threshold', 'durationMs', 'maxGapMs', 'maxAgeMs']} scales={{ durationMs: 1000, maxGapMs: 1000, maxAgeMs: 1000 }} times={['effectiveFrom', 'effectiveTo']} onSaved={saved}>
    <Pick name="bindingId" label="修订已有规则（新建时留空）" required={false} options={[...new Map(rules.data.map(r => [r.binding_id, { id: r.binding_id, name: r.name }])).values()]}/><Pick name="objectId" label="适用对象" options={config}/><Pick name="pointId" label="测点" options={points.data}/><Pick name="batchId" label="已核实物种与阶段批次" options={batches.data.filter(b => b.verified)}/><Field name="name" label="规则名称（修订时沿用原名称）"/>
    <Pick name="comparison" label="比较方式" options={[{ id: 'lt', name: '小于' }, { id: 'lte', name: '小于等于' }, { id: 'gt', name: '大于' }, { id: 'gte', name: '大于等于' }]}/><Field name="threshold" label="专业阈值（单位沿用测点）" type="number"/><Field name="durationMs" label="须连续满足的时长（秒）" type="number"/><Field name="maxGapMs" label="允许的最大采样间隔（秒）" type="number"/><Field name="maxAgeMs" label="测值新鲜度时限（秒）" type="number"/>
    <Pick name="severity" label="专业审核的告警级别" options={[{ id: 'info', name: '提示' }, { id: 'warning', name: '注意' }, { id: 'severe', name: '严重' }]}/><Field name="source" label="阈值与时效依据、适用限制"/><Field name="effectiveFrom" label="开始生效时间" type="datetime-local"/><Field name="effectiveTo" label="结束时间（可后补）" type="datetime-local" required={false}/>
  </ActionForm></details>}
  {!rules.data.length && <p className="empty-state">尚无规则。G05专业参数未齐时保持空白，不启用猜测阈值。</p>}
  {rules.data.map(r => <section className="rule-card" key={r.id}><h2>{r.name} · 版本 {r.version}</h2><p>{r.metric}：{r.threshold} {r.unit}；{r.approved_at ? '已专业审核' : '待审核'}；{r.enabled && r.active_version_id === r.id ? '当前启用' : '未启用'}。</p><p className="hint">{r.source}</p>
    {!r.approved_at && can('review', r.object_id) && <ActionForm path="/api/v1/rules" method="PATCH" onSaved={saved} label="确认专业审核"><input type="hidden" name="id" value={r.id}/><input type="hidden" name="operation" value="approve"/><Field name="evidence" label="审核结论与依据"/></ActionForm>}
    {!!r.approved_at && can('configure', r.object_id) && <ActionForm path="/api/v1/rules" method="PATCH" booleans={['enabled']} onSaved={saved} label="保存启停状态"><input type="hidden" name="id" value={r.id}/><input type="hidden" name="operation" value="enable"/><label><input type="checkbox" name="enabled" defaultChecked={r.enabled && r.active_version_id === r.id}/>启用本版本（取消勾选即停用）</label></ActionForm>}
  </section>)}
  </>;
}
