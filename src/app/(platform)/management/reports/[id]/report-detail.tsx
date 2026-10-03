'use client';
import {useApi} from '@/components/platform/use-api';import ReportSummary from '@/components/phase4/report-summary';
export default function ReportDetail({id}:{id:string}){const {data,error,reload}=useApi<Record<string,any>>('/api/v1/management/report?id='+encodeURIComponent(id));if(error)return <><p role="alert">{error}</p><button onClick={()=>void reload()}>重新核对授权</button></>;if(!data)return <p>正在读取固定报告…</p>;return <><ReportSummary report={data}/><p>输入快照校验：{data.input_hash??'尚未生成'}</p><p className="hint">这是生成时点的固定记录；当前状态请重新生成报告核对，原件和内部业务页面仍受各自权限约束。</p></>;}
