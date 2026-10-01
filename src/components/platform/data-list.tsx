'use client';
import { useEffect, useState } from 'react';
export function formatValue(key: string, value: unknown): string {
    if (value === null || value === undefined)
        return '未登记';
    if (typeof value === 'boolean')
        return key === 'enabled' ? (value ? '已启用' : '已停用') : key === 'night_shift' ? (value ? '夜班' : '白班') : key === 'connected' ? (value ? '已接通' : '未接通') : (value ? '已核实' : '待核实');
    const labels: Record<string, Record<string, string>> = { kind: { farm: '场区', pond: '塘口', field: '地块', channel: '渠道', facility: '设施', physical: '物理设备', gateway: '网关', camera_channel: '摄像通道', measurement: '测值告警', monitoring_gap: '监测中断', source_unavailable: '来源不可用' }, boundary_status: { unknown: '待核实', draft: '待确认', verified: '已核实' }, state: { open: '待处理', recovered: '恢复待关闭', closed: '已关闭', queued: '待发送', sending: '正在发起', accepted: '服务商已受理', delivered: '已送达', failed: '失败', unknown: '结果未知', blocked: '依赖未就绪', cancelled: '已取消' }, severity: { info: '提示', warning: '注意', severe: '严重' }, quality: { valid: '有效', suspect: '待核', invalid: '无效' }, data_quality: { valid: '有效', suspect: '待核' }, channel: { wecom: '企业微信', voice: '电话' }, phase: { initial: '首次通知', recovery: '恢复通知', escalation: '未认领升级', reminder: '合并提醒', admin_reminder: '管理员提醒' } };
    if (labels[key]?.[String(value)])
        return labels[key][String(value)];
    if (key.endsWith('_at') && typeof value === 'string' && Number.isFinite(Date.parse(value)))
        return new Date(value).toLocaleString('zh-CN');
    return String(value);
}
export default function DataList({ path, columns, linkPrefix, emptyText = '当前没有已授权的记录。可由管理员在配置管理中登记并授权。' }: {
    path: string;
    columns: {
        key: string;
        label: string;
    }[];
    linkPrefix?: string;
    emptyText?: string;
}) {
    const [rows, setRows] = useState<Record<string, unknown>[]>([]), [error, setError] = useState(''), [loaded, setLoaded] = useState(false);
    useEffect(() => { let active = true; fetch(path).then(async (r) => { const d = await r.json(); if (!r.ok)
        throw Error(d.message ?? '加载失败'); if (active) {
        setRows(Array.isArray(d) ? d : d.items);
        setLoaded(true);
    } }).catch(e => { if (active)
        setError(e.message); }); return () => { active = false; }; }, [path]);
    if (error)
        return <p className="form-error" role="alert">{error}</p>;
    if (!loaded)
        return <p>正在加载…</p>;
    if (!rows.length)
        return <p className="empty-state">{emptyText}</p>;
    return <div className="table-wrap"><table><thead><tr>{columns.map(c => <th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={String(r.id ?? i)}>{columns.map((c, j) => <td key={c.key}>{linkPrefix && j === 0 ? <a href={linkPrefix + encodeURIComponent(String(r.id))}>{formatValue(c.key, r[c.key])}</a> : formatValue(c.key, r[c.key])}</td>)}</tr>)}</tbody></table></div>;
}
