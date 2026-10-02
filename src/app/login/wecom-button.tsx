'use client';
import {useState} from 'react';
export default function WecomButton(){const[message,setMessage]=useState(''),[busy,setBusy]=useState(false);return <><button className="secondary" disabled={busy} onClick={async()=>{setBusy(true);try{const r=await fetch('/api/v1/auth/wecom/start',{method:'POST'}),d=await r.json();if(!r.ok)throw Error(d.message);window.location.assign(d.url);}catch(e){setMessage(e instanceof Error?e.message:'企业微信登录未完成');setBusy(false);}}}>企业微信成员登录</button>{message&&<p role="alert">{message}</p>}</>;}
