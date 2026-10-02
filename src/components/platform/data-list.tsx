'use client';
import { useState } from 'react';
import {useApi} from './use-api';
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
    const {data,error,loading,reload}=useApi<Record<string,unknown>[]|{items:Record<string,unknown>[];total?:number;nextCursor?:string|null}>(path),[query,setQuery]=useState(''),[sort,setSort]=useState('');
    const rows=Array.isArray(data)?data:data?.items??[],shown=rows.filter(r=>columns.some(c=>formatValue(c.key,r[c.key]).toLowerCase().includes(query.toLowerCase())));
    if(sort)shown.sort((a,b)=>{const av=a[sort],bv=b[sort];return typeof av==='number'&&typeof bv==='number'?av-bv:formatValue(sort,av).localeCompare(formatValue(sort,bv),'zh-CN',{numeric:true});});
    if (error)
        return <div className="empty-state"><p className="form-error" role="alert">{error}</p><button className="secondary" onClick={()=>void reload()}>重试读取</button></div>;
    if (loading)
        return <p className="loading-state" role="status">正在加载…</p>;
    if(data!==null&&!Array.isArray(data)&&!Array.isArray(data.items))return <p className="form-error" role="alert">服务器返回的列表格式未通过核对，请重新读取。</p>;
    if (!rows.length)
        return <p className="empty-state">{emptyText}</p>;
    return <div className="data-list"><div className="list-toolbar"><label>筛选当前列表<input value={query} onChange={e=>setQuery(e.target.value)} type="search" placeholder="按名称、编号或状态查找"/></label><label>排序字段<select value={sort} onChange={e=>setSort(e.target.value)}><option value="">原始顺序</option>{columns.map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</select></label><span>{shown.length} / 已载入{rows.length}条</span></div>{!shown.length?<p className="empty-state">当前列表没有匹配记录。</p>:<div className="table-wrap"><table><thead><tr>{columns.map(c => <th key={c.key} scope="col">{c.label}</th>)}</tr></thead><tbody>{shown.map((r, i) => <tr key={String(r.id ?? i)}>{columns.map((c, j) => <td key={c.key} data-label={c.label}>{linkPrefix && j === 0 ? <a href={linkPrefix + encodeURIComponent(String(r.id))}>{formatValue(c.key, r[c.key])}</a> : formatValue(c.key, r[c.key])}</td>)}</tr>)}</tbody></table></div>}{!Array.isArray(data)&&data&&(data.nextCursor||typeof data.total==='number'&&data.total>rows.length)&&<p className="hint">此处显示当前加载的记录，筛选与排序不代表全部历史。</p>}</div>;
}
