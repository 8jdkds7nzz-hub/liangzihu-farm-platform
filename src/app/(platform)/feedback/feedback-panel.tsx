'use client';
import { useApi } from '@/components/platform/use-api';
import ActionForm from '@/components/platform/action-form';
import { Field,Pick,type Option } from '@/components/platform/fields';
type Feedback={id:string;object_id:string;object_name:string;title:string;description:string;page_path:string;created_at:string;reporter_name:string;state:string};
type Data={items:Feedback[];counts:{state:string;count:number}[];events:{id:string;feedback_id:string;actor_name:string;note:string;occurred_at:string}[]};
const labels:Record<string,string>={open:'待处理',triaged:'正在跟进',resolved:'已处理'};
export default function FeedbackPanel({pagePath}:{pagePath:string}){
  const me=useApi<{scopes:{action:string;objectIds:string[]}[]}>('/api/v1/me'),objects=useApi<{items:Option[]}>('/api/v1/objects?limit=200'),feedback=useApi<Data>('/api/v1/feedback');
  const error=me.error||objects.error||feedback.error;if(error)return <p className="form-error">{error}</p>;if(!me.data||!objects.data||!feedback.data)return <p>正在读取反馈…</p>;
  return <><ActionForm path="/api/v1/feedback" stableKey onSaved={()=>void feedback.reload()} label="提交问题"><Pick name="objectId" label="问题关联对象" options={objects.data.items}/><Field name="title" label="问题标题"/><label>操作步骤、看到的现象和预期结果<textarea name="description" required maxLength={2000} rows={4}/></label><label>发生页面<input name="pagePath" value={pagePath} readOnly/></label></ActionForm>
    <h2>当前可见范围汇总</h2><p>{feedback.data.counts.map(c=>labels[c.state]+' '+c.count+' 条').join('；')||'尚无反馈。'}</p>
    {feedback.data.items.map(f=><section className="rule-card" key={f.id}><h2>{f.title} · {labels[f.state]}</h2><p className="hint">{f.object_name}；{f.reporter_name}；{new Date(f.created_at).toLocaleString()}；页面 {f.page_path}</p><p>{f.description}</p>
      {f.state!=='resolved'&&me.data!.scopes.some(s=>s.action==='configure'&&s.objectIds.includes(f.object_id))&&<ActionForm path="/api/v1/feedback" method="PATCH" stableKey onSaved={()=>void feedback.reload()} label="登记处理进展"><input type="hidden" name="id" value={f.id}/><Pick name="state" label="处理状态" options={[{id:'triaged',name:'正在跟进'},{id:'resolved',name:'已处理'}]}/><Field name="note" label="处理结果或后续安排"/></ActionForm>}
      <ul>{feedback.data!.events.filter(e=>e.feedback_id===f.id).map(e=><li key={e.id}>{e.actor_name}：{e.note}（{new Date(e.occurred_at).toLocaleString()}）</li>)}</ul>
    </section>)}
  </>;
}
