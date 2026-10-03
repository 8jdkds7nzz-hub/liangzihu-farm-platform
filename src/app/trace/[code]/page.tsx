import {transaction} from '@/db/pool';import {publicCard} from '@/modules/traceability/public';import {AppError} from '@/platform/error';import {notFound} from 'next/navigation';import {connection} from 'next/server';
export const metadata={title:'农产品批次查询',robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{code:string}>}){
 await connection();const {code}=await params;let data;
 try{data=await transaction(c=>publicCard(c,code));}catch(e){if(e instanceof AppError&&e.status===404)notFound();throw e;}
 const s=data.content;return <main className="workspace" style={{maxWidth:800,margin:'32px auto',padding:24}}><p className="eyebrow">农产品批次查询</p><h1>{s.productName}</h1><p>{s.batchLabel} · {s.granularity}</p><dl><dt>产区</dt><dd>{s.province} · {s.city} · {s.county}</dd><dt>采收月份</dt><dd>{s.harvestMonth}</dd></dl><h2>生产摘要</h2><p>{s.productionSummary}</p><h2>检测摘要</h2><p>{s.testSummary}</p><h2>查询范围与限制</h2><p>{s.limitations}</p><p className="hint">公开版本{data.version} · 审核时间{new Date(data.reviewedAt).toLocaleString('zh-CN')} · 有效截止{new Date(data.validUntil).toLocaleString('zh-CN')}</p><p>本页为当前可公开的批次信息。页面可能因资料更新或质量核查而撤回，请以重新访问时的状态为准。</p></main>;
}

