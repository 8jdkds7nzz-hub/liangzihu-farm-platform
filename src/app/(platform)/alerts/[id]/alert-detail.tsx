'use client';
import { useApi } from '@/components/platform/use-api';
import ActionForm from '@/components/platform/action-form';
import DataList, { formatValue } from '@/components/platform/data-list';
type Event = {
    id: string;
    event_type: string;
    note: string;
    occurred_at: string;
    actor_name: string | null;
    classification: string | null;
};
type Detail = {
    alert: {
        id: string;
        object_id: string;
        point_id: string | null;
        title: string;
        state: string;
        severity: string;
        data_quality: string;
        object_name: string;
        opened_at: string;
        first_notification_at: string | null;
    };
    events: Event[];
    claims: {
        id: string;
        purpose: string;
        actor_id: string;
        actor_name: string;
    }[];
    rule: {
        version: number;
        metric: string;
        unit: string;
        comparison: string;
        threshold: string;
        duration_ms: number;
        source: string;
        approval_evidence: string;
    } | null;
};
const eventLabels: Record<string, string> = { opened: '发现告警', continued: '持续越限', recurred: '再次发生', recovered: '监测恢复', claimed: '认领', field_check: '现场核查', repair: '排障处置', note: '补充说明', classification: '专业分类', closed: '关闭', data_conflict: '数据冲突', released: '交班释放' };
export default function AlertDetail({ id }: {
    id: string;
}) {
    const { data, error, reload } = useApi<Detail>('/api/v1/alerts/' + id), me = useApi<{
        actor: {
            id: string;
            role: string;
        };
        scopes: {
            action: string;
            objectIds: string[];
        }[];
    }>('/api/v1/me');
    if (error || me.error)
        return <p className="form-error" role="alert">{error || me.error}</p>;
    if (!data || !me.data)
        return <p>正在加载事件…</p>;
    const a = data.alert, user = me.data, can = (action: string) => user.scopes.some(s => s.action === action && s.objectIds.includes(a.object_id));
    const active = a.state !== 'closed', mine = (purpose: string) => data.claims.some(c => c.purpose === purpose && c.actor_id === user.actor.id);
    const saved = () => void reload();
    return <section className="workspace"><a href="/alerts">返回告警列表</a><h1>{a.title}</h1><p>{a.object_name} · {formatValue('severity', a.severity)} · <strong>{formatValue('state', a.state)}</strong></p>
    <p className="hint">测值依据：{formatValue('data_quality', a.data_quality)}；发现于 {new Date(a.opened_at).toLocaleString()}。首次通知：{a.first_notification_at ? new Date(a.first_notification_at).toLocaleString() : '尚未实际发起'}。</p>
    {a.point_id && <a className="health-link" href={'/points/' + a.point_id}>查看原始时间、质量与历史</a>}
    {data.rule && <details><summary>规则版本与依据</summary><p>版本 {data.rule.version}；{data.rule.metric} {({ lt: '小于', lte: '小于等于', gt: '大于', gte: '大于等于' } as Record<string, string>)[data.rule.comparison]} {data.rule.threshold} {data.rule.unit}，持续 {data.rule.duration_ms / 1000} 秒。</p><p>{data.rule.source}</p><p>审核依据：{data.rule.approval_evidence}</p></details>}
    <h2>责任分工</h2>{active ? <p>现场核查：{data.claims.find(c => c.purpose === 'field_check')?.actor_name ?? '尚未认领'}；排障：{data.claims.find(c => c.purpose === 'repair')?.actor_name ?? '尚未认领'}。</p> : <p>本事件已关闭，认领已结束。人员与依据见处理记录。</p>}
    {active && can('claim') && (['field_check', 'repair'] as const).filter(p => !data.claims.some(c => c.purpose === p) && (user.actor.role !== 'worker' || p === 'field_check') && (user.actor.role !== 'maintainer' || p === 'repair')).map(p => <ActionForm key={p} path={'/api/v1/alerts/' + id + '/claim'} stableKey onSaved={saved} label={p === 'field_check' ? '认领现场核查' : '认领排障'}><input type="hidden" name="purpose" value={p}/></ActionForm>)}
    {active && can('record') && (['field_check', 'repair'] as const).filter(mine).map(type => <ActionForm key={type} path={'/api/v1/alerts/' + id + '/events'} stableKey onSaved={saved} label={type === 'field_check' ? '保存现场核查' : '保存处置记录'}><input type="hidden" name="type" value={type}/><label>{type === 'field_check' ? '现场观察、复测结果与依据' : '已采取的措施、结果和依据'}<textarea name="note" required maxLength={4000} rows={4}/></label></ActionForm>)}
    {active && can('claim') && (['field_check', 'repair'] as const).filter(mine).map(purpose => <details key={'release-' + purpose}><summary>交班：结束我的{purpose === 'field_check' ? '现场核查' : '排障'}认领</summary><ActionForm path={'/api/v1/alerts/' + id + '/release'} stableKey onSaved={saved} label="提交交接说明并结束认领"><input type="hidden" name="purpose" value={purpose}/><label>已沟通的接班安排与仍需处理事项<textarea name="reason" required rows={3} maxLength={2000}/></label><p className="hint">此操作不关闭事件。接班人员须明确重新认领；无人接管时恢复未认领升级检查。</p></ActionForm></details>)}
    {active && can('review') && <details><summary>专业审核分类</summary><ActionForm path={'/api/v1/alerts/' + id + '/events'} stableKey onSaved={saved}><input type="hidden" name="type" value="classification"/><label>分类<select name="classification"><option value="unknown">仍未知</option><option value="normal">现场正常</option><option value="false_alarm">误报</option><option value="device_issue">设备问题</option></select></label><label>审核依据<textarea name="note" rows={3} required maxLength={4000}/></label></ActionForm></details>}
    {active && can('close_alert') && <details><summary>引用核查和处置记录后关闭</summary><ActionForm path={'/api/v1/alerts/' + id + '/close'} stableKey onSaved={saved} label="关闭此事件"><p className="hint">仍在越限或监测中断时不能直接关闭；误报须先由有专业审核权限的人员确认。</p>{[['fieldCheckId', 'field_check', '核查记录'], ['repairId', 'repair', '处置记录']].map(([name, type, label]) => <label key={name}>{label}<select name={name} aria-label={label} required defaultValue=""><option value="">请选择依据</option>{data.events.filter(e => e.event_type === type).map(e => <option key={e.id} value={e.id}>{e.actor_name}：{e.note.slice(0, 60)}</option>)}</select></label>)}<label>关闭分类<select name="classification"><option value="normal">恢复正常</option><option value="device_issue">设备问题已处理</option><option value="false_alarm">已专业审核为误报</option></select></label></ActionForm></details>}
    <h2>通知状态</h2><p className="hint">送达、接通与认领分别记录。非管理岗位仅查看发给本人的记录；当前真实企业微信和电话通道尚未开通。</p><DataList key={data.events.length} path={'/api/v1/alerts/' + id + '/notifications'} emptyText="尚无通知记录，不能推定已发送或已送达。" columns={[{ key: 'channel', label: '通道' }, { key: 'recipient_name', label: '接收人' }, { key: 'phase', label: '用途' }, { key: 'state', label: '发送状态' }, { key: 'connected', label: '电话接通' }, { key: 'started_at', label: '发起时间' }]}/>
    <h2>处理记录</h2><ol className="event-list">{data.events.map(e => <li key={e.id}><strong>{eventLabels[e.event_type] ?? e.event_type}</strong> · {e.actor_name ?? '平台记录'} · {new Date(e.occurred_at).toLocaleString()}<p>{e.note}</p>{e.classification && <p>{({ normal: '正常', false_alarm: '误报', device_issue: '设备问题', unknown: '未知' } as Record<string, string>)[e.classification]}</p>}</li>)}</ol>
  </section>;
}
