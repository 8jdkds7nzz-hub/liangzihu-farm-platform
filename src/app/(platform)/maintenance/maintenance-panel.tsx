'use client';
import { useApi } from '@/components/platform/use-api';
import ActionForm from '@/components/platform/action-form';
import { Field, Pick, type Option } from '@/components/platform/fields';
type Maintenance = {
    id: string;
    object_name: string;
    record_type: string;
    occurred_at: string;
    payload: {
        description: string;
        parameter: string | null;
        before: string | null;
        after: string | null;
        unit: string | null;
    };
    source: string;
    recorder_name: string;
    supersedes_id: string | null;
};
type Manual = {
    id: string;
    object_name: string;
    metric: string;
    raw_value: string;
    value: string | null;
    unit: string;
    method: string;
    source: string;
    occurred_at: string;
    supersedes_id: string | null;
};
type WorkOrder = {
    id: string;
    object_id: string;
    object_name: string;
    fault: string;
    state: string;
    responsible_role: string;
    assigned_to: string | null;
    assignee_name: string | null;
};
function AssigneeField({ objectId }: {
    objectId: string;
}) { const { data } = useApi<Option[]>('/api/v1/duty/people?objectId=' + objectId); return <Pick name="assignedTo" label="明确指定处理人员" options={(data ?? []).filter(u => ['maintainer', 'technician', 'owner'].includes(u.role ?? ''))}/>; }
const types = [{ id: 'cleaning', name: '清洁' }, { id: 'calibration', name: '校准' }, { id: 'replacement', name: '更换' }, { id: 'installation', name: '安装基准调整' }, { id: 'repair', name: '维修' }];
export default function MaintenancePanel() {
    const me = useApi<{
        actor: {
            id: string;
        };
        scopes: {
            action: string;
            objectIds: string[];
        }[];
    }>('/api/v1/me'), objects = useApi<{
        items: Option[];
    }>('/api/v1/objects?limit=200'), points = useApi<Option[]>('/api/v1/points'), records = useApi<{
        maintenance: Maintenance[];
        manual: Manual[];
    }>('/api/v1/maintenance'), orders = useApi<WorkOrder[]>('/api/v1/work-orders'), exports = useApi<{
        id: string;
        created_at: string;
        expires_at: string;
    }[]>('/api/v1/exports');
    const error = me.error || objects.error || points.error || records.error || orders.error || exports.error;
    if (error)
        return <p className="form-error">{error}</p>;
    if (!me.data || !objects.data || !points.data || !records.data || !orders.data || !exports.data)
        return <p>正在读取记录…</p>;
    const can = (action: string, id: string) => me.data!.scopes.some(s => s.action === action && s.objectIds.includes(id)), recordObjects = objects.data.items.filter(o => can('record', o.id)), exportObjects = objects.data.items.filter(o => can('export', o.id));
    const saved = () => { void records.reload(); void orders.reload(); };
    const scope = <><Pick name="objectId" label="对象" options={recordObjects}/><Pick name="pointId" label="测点（对象级维护可留空）" options={points.data} required={false}/><Field name="occurredAt" label="实际发生时间" type="datetime-local"/><Field name="source" label="依据、来源或现场记录编号"/></>;
    return <>{!!recordObjects.length && <>
    <details><summary>登记维护或追加更正</summary><ActionForm path="/api/v1/maintenance" stableKey times={['occurredAt']} onSaved={saved}><input type="hidden" name="kind" value="maintenance"/>{scope}<Pick name="recordType" label="维护类型" options={types}/><label>工作内容与结果<textarea name="description" required rows={3} maxLength={4000}/></label><Field name="parameter" label="校准参数名称（校准时必填）" required={false}/><Field name="before" label="原参数值" required={false}/><Field name="after" label="调整后参数值" required={false}/><Field name="unit" label="参数单位" required={false}/><Pick name="supersedesId" label="更正哪条原记录（新记录留空）" required={false} options={records.data.maintenance.map(r => ({ id: r.id, name: r.object_name + ' · ' + r.payload.description.slice(0, 40) }))}/></ActionForm></details>
    <details><summary>登记手持或人工复测</summary><ActionForm path="/api/v1/maintenance" stableKey times={['occurredAt']} numbers={['value']} onSaved={saved}><input type="hidden" name="kind" value="manual"/>{scope}<Field name="metric" label="复测指标代号"/><Field name="rawValue" label="原始读数（保留原写法）"/><Field name="value" label="可比较的数值（不确定时留空）" type="number" required={false}/><Field name="unit" label="单位"/><Field name="method" label="手持仪器编号、方法或实验室依据"/><Pick name="supersedesId" label="更正哪条复测（新记录留空）" required={false} options={records.data.manual.map(r => ({ id: r.id, name: r.object_name + ' · ' + r.metric + ' ' + r.raw_value + ' ' + r.unit }))}/></ActionForm></details>
    <details><summary>登记故障工单</summary><ActionForm path="/api/v1/work-orders" stableKey onSaved={saved}><Pick name="objectId" label="对象" options={recordObjects}/><label>故障和依据<textarea name="fault" required rows={3} maxLength={4000}/></label><Pick name="responsibleRole" label="需要的专业岗位" options={[{ id: 'maintainer', name: '维护人员' }, { id: 'technician', name: '技术员' }]}/><p className="hint">保存只登记故障，不自动指定人员或对外发送。</p></ActionForm></details>
  </>}
  <h2>维护记录（最近200条）</h2>{!records.data.maintenance.length && <p>尚无维护记录。</p>}{records.data.maintenance.map(r => <details key={r.id}><summary>{r.object_name} · {types.find(t => t.id === r.record_type)?.name} · {new Date(r.occurred_at).toLocaleString()}{r.supersedes_id ? ' · 更正记录' : ''}</summary><p>{r.payload.description}</p>{r.payload.parameter && <p>{r.payload.parameter}：{r.payload.before} → {r.payload.after} {r.payload.unit}</p>}<p className="hint">{r.recorder_name}；依据：{r.source}</p></details>)}
  <h2>人工复测（最近200条）</h2><div className="table-wrap"><table><thead><tr><th>对象</th><th>发生时间</th><th>指标</th><th>原值</th><th>单位</th><th>方法/依据</th><th>更正</th></tr></thead><tbody>{records.data.manual.map(r => <tr key={r.id}><td>{r.object_name}</td><td>{new Date(r.occurred_at).toLocaleString()}</td><td>{r.metric}</td><td>{r.raw_value}</td><td>{r.unit}</td><td>{r.method}；{r.source}</td><td>{r.supersedes_id ? '追加更正' : '原记录'}</td></tr>)}</tbody></table></div>
  <h2>故障工单</h2>{orders.data.map(w => <section className="rule-card" key={w.id}><h3>{w.object_name}：{w.fault}</h3><p>{({ open: '待人工安排', assigned: '已指定人员', handled: '处理完成待复核', reviewed: '已专业复核' } as Record<string, string>)[w.state]}；处理人：{w.assignee_name ?? '尚未指定'}</p>
    {w.state === 'open' && can('dispatch', w.object_id) && <ActionForm path="/api/v1/work-orders" method="PATCH" stableKey onSaved={saved} label="正式指定处理人员"><input type="hidden" name="id" value={w.id}/><input type="hidden" name="state" value="assigned"/><AssigneeField objectId={w.object_id}/><Field name="note" label="安排依据"/></ActionForm>}
    {w.state === 'assigned' && w.assigned_to === me.data!.actor.id && can('record', w.object_id) && <ActionForm path="/api/v1/work-orders" method="PATCH" stableKey onSaved={saved} label="提交处理结果"><input type="hidden" name="id" value={w.id}/><input type="hidden" name="state" value="handled"/><Field name="note" label="实际措施和结果"/></ActionForm>}
    {w.state === 'handled' && can('review', w.object_id) && <ActionForm path="/api/v1/work-orders" method="PATCH" stableKey onSaved={saved} label="确认复核"><input type="hidden" name="id" value={w.id}/><input type="hidden" name="state" value="reviewed"/><Field name="note" label="复核结论与依据"/></ActionForm>}
  </section>)}
  <h2>受控导出</h2>{!!exportObjects.length && <ActionForm path="/api/v1/exports" times={['from', 'to']} onSaved={() => void exports.reload()} label="生成JSON导出"><Pick name="objectId" label="导出对象" options={exportObjects}/><Field name="from" label="测值开始时间" type="datetime-local"/><Field name="to" label="测值结束时间（最多31天）" type="datetime-local"/><p className="hint">保留单位、质量、绑定版本及更正关系；不含共享原报文正文。下载有效期24小时，下载时再次核验权限。</p></ActionForm>}
  <ul className="link-list">{exports.data.map(e => <li key={e.id}><a href={'/api/v1/exports/' + e.id}>下载 {new Date(e.created_at).toLocaleString()} 生成的导出</a> · <a href={'/api/v1/exports/'+e.id+'/bundle'}>下载资料与附件原件包</a>（{new Date(e.expires_at).toLocaleString()} 到期）</li>)}</ul>
  </>;
}
