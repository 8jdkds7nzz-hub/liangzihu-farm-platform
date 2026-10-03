'use client';
import {useState,type ReactNode} from 'react';import {useApi} from '@/components/platform/use-api';
export default function ObjectWorkspace({children}:{children:(id:string)=>ReactNode}){
 const refs=useApi<{items:{id:string;name:string;code:string}[]}>('/api/v1/references?kind=object'),[selected,setSelected]=useState(''),id=selected||refs.data?.items[0]?.id||'';
 if(refs.error)return <p role="alert">{refs.error}</p>;
 return <><label>当前对象<select aria-label="当前对象" value={id} onChange={e=>setSelected(e.target.value)}><option value="">请选择</option>{refs.data?.items.map(r=><option value={r.id} key={r.id}>{r.name} · {r.code}</option>)}</select></label>{id?<div key={id}>{children(id)}</div>:<p className="empty-state">当前没有已授权对象，请先登记并授权。</p>}</>;
}

