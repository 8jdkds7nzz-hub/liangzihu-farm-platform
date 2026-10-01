'use client';
import { useState, type FormEvent } from 'react';
import { useApi } from '@/components/platform/use-api';
import { formatValue } from '@/components/platform/data-list';
type Reading = {
    id: string;
    sampled_at: string;
    reported_at: string | null;
    received_at: string;
    value: number | null;
    raw_value: string | number | null;
    unit: string;
    quality: string;
    canonical: boolean;
    conflicted: boolean;
    origin: string;
};
type History = {
    point: {
        name: string;
        unit: string;
        maxGapMs: number | null;
        timingSource: string | null;
    };
    items: Reading[];
    current: {
        value: number;
        sampled_at: string;
    } | null;
    dataState: string;
    communication: {
        state: string;
        lastSuccessAt: string | null;
    };
    gaps: {
        from: string;
        to: string;
    }[];
    maintenance: {
        id: string;
        occurred_at: string;
        record_type: string;
        payload: {
            description: string;
        };
    }[];
    manualChecks: {
        id: string;
        occurred_at: string;
        raw_value: string;
        unit: string;
        method: string;
        supersedes_id: string | null;
    }[];
    nextCursor: string | null;
};
function Curve({ rows, maxGapMs, unit }: {
    rows: Reading[];
    maxGapMs: number | null;
    unit: string;
}) {
    const valid = rows.filter(r => r.value !== null && Number.isFinite(r.value) && r.canonical), values = valid.map(r => r.value!);
    if (!valid.length)
        return <p className="empty-state">该时段没有可绘制测值，未补零或插值。</p>;
    const min = Math.min(...values), max = Math.max(...values), first = Date.parse(valid[0].sampled_at), last = Date.parse(valid.at(-1)!.sampled_at);
    const x = (r: Reading) => 80 + 595 * (Date.parse(r.sampled_at) - first) / Math.max(1, last - first), y = (r: Reading) => 150 - 115 * ((r.value! - min) / (max - min || 1));
    const lines: string[][] = [];
    let segment: string[] = [];
    let previous: Reading | null = null;
    for (const r of rows) {
        const good = r.value !== null && r.quality === 'valid' && r.canonical && !r.conflicted;
        if (!good || !maxGapMs || (previous && Date.parse(r.sampled_at) - Date.parse(previous.sampled_at) > maxGapMs)) {
            if (segment.length)
                lines.push(segment);
            segment = [];
        }
        if (good) {
            segment.push(`${x(r)},${y(r)}`);
            previous = r;
        }
        else
            previous = null;
    }
    if (segment.length)
        lines.push(segment);
    return <svg className="history-curve" viewBox="0 0 720 200" role="img" aria-label={'监测历史曲线，单位' + unit + '；缺测及异常处断开'}><line x1="80" x2="690" y1="155" y2="155" stroke="#bdcfc1"/><text x="5" y="25" fontSize="20">{max.toFixed(2)}</text><text x="5" y="155" fontSize="20">{min.toFixed(2)}</text>{lines.map((line, i) => <polyline key={i} points={line.join(' ')} fill="none" stroke="#28543d" strokeWidth="2"/>)}{valid.map(r => <circle key={r.id} cx={x(r)} cy={y(r)} r="3" fill={r.quality === 'valid' && !r.conflicted ? '#28543d' : '#b76726'}><title>{new Date(r.sampled_at).toLocaleString()}：{r.value} {unit}</title></circle>)}<text x="80" y="185" fontSize="20">{new Date(first).toLocaleTimeString()}</text><text x="690" y="185" fontSize="20" textAnchor="end">{new Date(last).toLocaleTimeString()}</text></svg>;
}
export default function PointHistory({ id }: {
    id: string;
}) {
    const [query, setQuery] = useState(''), { data, error } = useApi<History>('/api/v1/points/' + id + '/readings' + query);
    function filter(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const f = new FormData(e.currentTarget); setQuery('?' + new URLSearchParams({ from: new Date(String(f.get('from'))).toISOString(), to: new Date(String(f.get('to'))).toISOString() }).toString()); }
    const states: Record<string, string> = { fresh: '数据新鲜', stale: '测值已过期', missing: '当前对应关系下尚无有效测值', suspect: '数据待核', unconfigured: '时效尚未配置', unverified_mapping: '当前测点对应关系待核实', history_only: '仅可查看历史授权数据' };
    return <section className="workspace"><a href="/devices">返回设备与测点</a><h1>{data?.point.name ?? '测点历史'}</h1><form className="range-form" onSubmit={filter}><label>开始时间<input name="from" type="datetime-local" required/></label><label>结束时间<input name="to" type="datetime-local" required/></label><button>查询（最多31天）</button></form>{error && <p className="form-error" role="alert">{error}</p>}
    {data && <><div className="status-grid"><div><h2>测值状态</h2><strong>{states[data.dataState] ?? data.dataState}</strong><p>最后有效值：{data.current?.value ?? '未知'} {data.point.unit}</p><p>采样：{data.current ? new Date(data.current.sampled_at).toLocaleString() : '未知'}</p></div><div><h2>来源通信</h2><strong>{data.communication.state === 'last_contact_succeeded' ? '最近一次通信成功' : data.communication.state === 'unknown' ? '尚无通信依据' : '来源不可用'}</strong><p>最后成功：{data.communication.lastSuccessAt ? new Date(data.communication.lastSuccessAt).toLocaleString() : '未知'}</p><p className="hint">通信成功不等于测值仍然新鲜。</p></div></div><p className="hint">时效依据：{data.point.timingSource ?? '尚未登记'}。异常点与缺口不连成正常曲线；未配置间隔时只显示测值点。</p><Curve rows={data.items} maxGapMs={data.point.maxGapMs} unit={data.point.unit}/>
      {!!data.gaps.length && <p className="form-error">当前页检测到 {data.gaps.length} 段采样间隔缺口。</p>}
      {!!data.maintenance.length && <div><h2>该时段的维护标记</h2><ul>{data.maintenance.map(m => <li key={m.id}>{new Date(m.occurred_at).toLocaleString()} · {m.payload.description}</li>)}</ul></div>}
      {!!data.manualChecks.length && <div><h2>手持/人工复测（未合并到在线曲线）</h2><ul>{data.manualChecks.map(m => <li key={m.id}>{new Date(m.occurred_at).toLocaleString()} · {m.raw_value} {m.unit}；{m.method}{m.supersedes_id ? '；追加更正记录' : ''}</li>)}</ul></div>}
      <p className="hint">表格可横向滑动，查看完整时间、原值与质量。</p><div className="table-wrap"><table><thead><tr><th>采样时间</th><th>上报时间</th><th>接收时间</th><th>原值</th><th>标准值</th><th>质量</th></tr></thead><tbody>{data.items.map(r => <tr key={r.id}><td>{new Date(r.sampled_at).toLocaleString()}</td><td>{r.reported_at ? new Date(r.reported_at).toLocaleString() : '未知'}</td><td>{new Date(r.received_at).toLocaleString()}</td><td>{r.raw_value ?? '未知'}</td><td>{r.value ?? '无效/未知'} {r.unit}</td><td>{r.conflicted ? '冲突待核' : formatValue('quality', r.quality)}</td></tr>)}</tbody></table></div>
      {data.nextCursor && <button className="secondary" onClick={() => { const p = new URLSearchParams(query.replace(/^\?/, '')); p.set('cursor', data.nextCursor!); setQuery('?' + p.toString()); }}>查看下一页（当前曲线只表示本页数据）</button>}
    </>}
  </section>;
}
