'use client';
import { useApi } from '@/components/platform/use-api';
import { formatValue } from '@/components/platform/data-list';
type Detail = {
    object: {
        name: string;
        kind: string;
        boundary_status: string;
        source: string;
    };
    points: {
        id: string;
        name: string;
        metric: string;
        unit: string;
    }[];
    alerts: {
        id: string;
        title: string;
        state: string;
        severity: string;
    }[];
};
export default function ObjectDetail({ id }: {
    id: string;
}) { const { data, error } = useApi<Detail>('/api/v1/objects/' + id); if (error)
    return <p className="form-error">{error}</p>; if (!data)
    return <p>正在读取对象…</p>; return <section className="workspace"><a href="/objects">返回对象台账</a><h1>{data.object.name}</h1><p>{formatValue('kind', data.object.kind)}；边界：{formatValue('boundary_status', data.object.boundary_status)}</p><p className="hint">来源：{data.object.source}</p><h2>测点与历史</h2>{data.points.length ? <ul className="link-list">{data.points.map(p => <li key={p.id}><a href={'/points/' + p.id}>{p.name}</a> · {p.metric}（{p.unit}）</li>)}</ul> : <p className="empty-state">尚无关联测点。不会显示虚构监测值。</p>}<h2>未关闭事件</h2>{data.alerts.length ? <ul className="link-list">{data.alerts.map(a => <li key={a.id}><a href={'/alerts/' + a.id}>{a.title}</a> · {formatValue('severity', a.severity)} · {formatValue('state', a.state)}</li>)}</ul> : <p>当前没有未关闭事件；这不代替监测可用性检查。</p>}</section>; }
