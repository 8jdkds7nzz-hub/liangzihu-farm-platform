'use client';
import { useEffect,useState } from 'react';
export default function DataList({path,columns}:{path:string;columns:{key:string;label:string}[]}){
  const [rows,setRows]=useState<Record<string,unknown>[]>([]),[error,setError]=useState(''),[loaded,setLoaded]=useState(false);
  useEffect(()=>{let active=true;fetch(path).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.message??'加载失败');if(active){setRows(Array.isArray(d)?d:d.items);setLoaded(true);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[path]);
  if(error)return <p className="form-error" role="alert">{error}</p>;
  if(!loaded)return <p>正在加载…</p>;
  if(!rows.length)return <p className="empty-state">当前没有已授权的记录。可由管理员在配置管理中登记并授权。</p>;
  return <div className="table-wrap"><table><thead><tr>{columns.map(c=><th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={String(r.id??i)}>{columns.map(c=><td key={c.key}>{typeof r[c.key]==='boolean'?(r[c.key]?'已核实':'待核实'):String(r[c.key]??'未登记')}</td>)}</tr>)}</tbody></table></div>;
}
