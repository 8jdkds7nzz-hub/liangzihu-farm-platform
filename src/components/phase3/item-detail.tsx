'use client';
import {useApi} from '@/components/platform/use-api';import {StockTable} from '@/app/(platform)/inventory/panel';import GeometryPreview from './geometry-preview';
export default function ItemDetail({kind,id}:{kind:'lot'|'plan'|'prescription'|'crop'|'spectral'|'notice';id:string}){
 const path=kind==='lot'?'/api/v1/inventory/lot':kind==='plan'||kind==='prescription'?'/api/v1/protection/'+kind:'/api/v1/agronomy/'+kind;
 const {data,error,loading,reload}=useApi<Record<string,any>>(path+'?id='+encodeURIComponent(id));if(error)return <><p role="alert">{error}</p><button onClick={()=>void reload()}>重新核对授权</button></>;if(loading||!data)return <p>正在读取授权资料…</p>;
 if(kind==='lot')return <><StockTable rows={[data.lot]} columns={[[ 'product','品名'],['code','批号'],['unit','单位'],['basis','数量口径'],['identities','身份映射'],['state','审核状态']]}/><StockTable rows={data.entries} columns={[[ 'kind','动作'],['delta','数量变化'],['location_name','仓位'],['occurred_at','发生时刻'],['evidence','依据']]}/><p className="hint">仅当前分享批次，最多200条分录；审核状态还须结合当前质量依据。</p></>;
 if(kind==='plan')return <><h2>{data.title}</h2><p>{data.crop} · {data.stage} · {data.target}</p><GeometryPreview boundary={data.boundary}/><p>障碍：{data.obstacles}</p><p>敏感邻区：{data.sensitive_note}</p><p>执行条件：{data.conditions}</p><p>来源：{data.source}</p><p>版本{data.version}</p></>;
 if(kind==='prescription')return <><h2>处方版本{data.version}</h2><p>{data.state} · {data.dose_unit}</p><p>{data.basis}</p><StockTable rows={data.zones} columns={[[ 'name','分区'],['rate','专业填写每亩剂量'],['geometry','分区范围']]}/></>;
 if(kind==='notice')return <><h2>{data.title}</h2><p>{data.agency} · {data.source_ref}</p><p>{data.state} · 适用截止{data.valid_until}</p><p>{data.body}</p><p>{data.review_note}</p></>;
 return <><p>{data.state} · {data.error_code??''}</p>{data.result?<><StockTable rows={[data.result]} columns={kind==='crop'?[[ 'greenFraction','绿色像素比例'],['candidates','模型候选'],['agronomicValidation','农业效果验证']]:[[ 'index','指数'],['validPixels','有效像素'],['noDataPixels','缺口'],['zones','分区统计']]}/>{data.result.limitations?.map((s:string)=><p key={s}>{s}</p>)}</>:<p>分析尚未完成。</p>}<p className="hint">原件和派生成果文件需要独立媒体授权，固定资料授权不会扩大为全对象浏览。</p></>;
}

