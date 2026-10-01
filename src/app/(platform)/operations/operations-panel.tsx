'use client';
import { useApi } from '@/components/platform/use-api';
import { Field, Pick, type Option } from '@/components/platform/fields';
import ActionForm from '@/components/platform/action-form';
type Health = {
    ready: boolean;
    services: {
        service: string;
        ready: boolean;
        state: string;
        observedAt: string | null;
        lastSuccessAt: string | null;
        detailCode: string | null;
    }[];
    backup: {
        ready: boolean;
        latestRecoverableAt: string | null;
    };
    jobs: {
        state: string;
        count: number;
    }[];
    recovery: {
        id: string;
        recorded_at: string;
        result: {
            pass: boolean;
            productionReady: boolean;
            rpoMs: number;
            rtoMs: number;
            reasons: string[];
        };
    }[];
};
type Budget = {
    id: string;
    object_id: string;
    category: string;
    month: string;
    limit_amount: string;
    known_amount: string;
    unknown_cost_count: number;
    at_eighty: boolean;
    at_limit: boolean;
    source: string;
};
const services: Record<string, string> = { ingest: '设备采集', alarms: '规则告警', notifications: '通知处理' };
export default function OperationsPanel() {
    const health = useApi<Health>('/api/v1/operations'), budgets = useApi<Budget[]>('/api/v1/budgets'), objects = useApi<{
        items: Option[];
    }>('/api/v1/objects?action=configure&limit=200');
    const error = health.error || budgets.error || objects.error;
    if (error)
        return <p className="form-error" role="alert">{error}</p>;
    if (!health.data || !budgets.data || !objects.data)
        return <p>正在读取运行状态…</p>;
    return <><p className={health.data.ready ? 'hint' : 'form-error'}>{health.data.ready ? '当前检查项就绪；仍需按批准范围使用。' : '当前尚未全部就绪，请查看下方缺口；不能接管现场值守。'}</p><button className="secondary" onClick={() => { void health.reload(); void budgets.reload(); }}>重新检查</button>
    <div className="status-grid">{health.data.services.map(s => <div key={s.service}><h2>{services[s.service]}</h2><strong>{s.ready ? '近期成功处理' : s.state === 'blocked' ? '外部依赖未就绪' : s.state === 'missing' ? '尚无运行记录' : '停止、失败或处理已过期'}</strong><p>最近运行：{s.observedAt ? new Date(s.observedAt).toLocaleString() : '未知'}</p><p>最近成功处理：{s.lastSuccessAt ? new Date(s.lastSuccessAt).toLocaleString() : '未知'}</p></div>)}<div><h2>备份恢复点</h2><strong>{health.data.backup.ready ? '校验与时效检查通过' : '未有可证明满足15分钟的备份链'}</strong><p>最新可恢复时点：{health.data.backup.latestRecoverableAt ? new Date(health.data.backup.latestRecoverableAt).toLocaleString() : '未知'}</p></div></div>
    <h2>待处理任务</h2><ul>{health.data.jobs.map(j => <li key={j.state}>{({ queued: '排队', retry_wait: '等待重试', awaiting_receipt: '等待外部结果核实', failed: '处理失败' } as Record<string, string>)[j.state]}：{j.count}</li>)}</ul>
    <h2>恢复演练记录</h2>{!health.data.recovery.length && <p>尚无登记的生产恢复演练。隔离测试结果不能代替NAS、云服务和真实通知的验收。</p>}{health.data.recovery.map(r => <p key={r.id}>{new Date(r.recorded_at).toLocaleString()}：{r.result.productionReady ? '本次登记范围通过' : '尚未通过全部生产条件'}；{r.result.reasons.join('；')}</p>)}
    <h2>预算与已知费用</h2><p className="hint">未知费用保持待核，不用通知次数猜金额。达到80%会显示提醒；必要告警通知持续记账，严重电话不会因预算上限被停用。</p>
    <details><summary>登记已批准的月度预算</summary><ActionForm path="/api/v1/budgets" numbers={['limitAmount']} onSaved={() => void budgets.reload()}><Pick name="objectId" label="对象" options={objects.data.items}/><Pick name="category" label="费用类别" options={[{ id: 'voice', name: '电话通知' }, { id: 'wecom', name: '企业微信通知' }, { id: 'storage', name: '存储与备份' }]}/><Field name="month" label="预算月份（例如YYYY-MM-01）"/><Field name="limitAmount" label="批准上限（元）" type="number"/><Field name="source" label="批准记录或预算依据"/></ActionForm></details>
    {!budgets.data.length && <p>尚未登记实际预算。</p>}<div className="table-wrap"><table><thead><tr><th>对象</th><th>费用类别</th><th>月份</th><th>批准上限</th><th>账单已知金额</th><th>待核费用笔数</th><th>状态</th></tr></thead><tbody>{budgets.data.map(b => <tr key={b.id}><td>{objects.data!.items.find(o => o.id === b.object_id)?.name ?? '已授权对象'}</td><td>{({ voice: '电话通知', wecom: '企业微信', storage: '存储与备份' } as Record<string, string>)[b.category] ?? b.category}</td><td>{String(b.month).slice(0, 7)}</td><td>{b.limit_amount}</td><td>{b.known_amount}</td><td>{b.unknown_cost_count}</td><td>{b.at_limit ? '已达上限' : b.at_eighty ? '达到80%，需复核' : b.unknown_cost_count ? '费用尚不完整' : '未达提醒线'}</td></tr>)}</tbody></table></div>
  </>;
}
