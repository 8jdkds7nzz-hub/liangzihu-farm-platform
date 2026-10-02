import type {Evidence} from '../knowledge/service';
export const PROMPT_VERSION='farm-evidence-json-v2';
export function redact(s:string,names:string[]=[]){
 let value=s;
 for(const name of [...names].filter(n=>n.length>=2).sort((a,b)=>b.length-a.length))value=value.split(name).join('[已去除身份或位置]');
 return value.replace(/(?:\+?86[- ]?)?1[3-9]\d{9}/g,'[手机号已去除]').replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[邮箱已去除]').replace(/(?:经度|纬度|longitude|latitude|lng|lat)\s*[:：=]?\s*-?\d+(?:\.\d+)?/gi,'[精确坐标已去除]').replace(/-?\d{1,3}\.\d{4,}\s*[,，]\s*-?\d{1,3}\.\d{4,}/g,'[精确位置已去除]').replace(/https?:\/\/\S+/g,'[外部地址已去除]');
}
export type Fact={id:string;objectCode:string;status:string;value:number|null;unit:string;limitations:string[];name?:string;definitionVersion?:number;windowStart?:string;windowEnd?:string;calculatedAt?:string;coverage?:number;kind?:string;text?:string};
const numbers=(s:string)=>s.match(/(?<!\d)-?\d+(?:\.\d+)?/g)??[];
export function validateAnswer(output:unknown,evidence:Evidence[],facts:Fact[]){
 const errors:string[]=[];
 if(!output||typeof output!=='object'||Array.isArray(output))return {valid:false,errors:['输出不是结构化JSON']};
 const r=output as Record<string,unknown>;
 if(r.toolCalls||r.sql||r.actions)errors.push('包含未允许的工具或动作');
 if(!Array.isArray(r.claims)||!r.claims.length||r.claims.length>10)return {valid:false,errors:[...errors,'缺少1至10条有据陈述']};
 const eIds=new Set(evidence.map(e=>e.chunkId)),fIds=new Set(facts.map(f=>f.id));
 for(const value of r.claims){
  const c=value as Record<string,unknown>;
  if(!c||typeof c.text!=='string'||c.text.length>2000||!Array.isArray(c.evidenceIds)||!Array.isArray(c.metricIds)||!Array.isArray(c.limitations)){errors.push('条目字段不完整');continue;}
  if(c.evidenceIds.some(id=>!eIds.has(id))||c.metricIds.some(id=>!fIds.has(id)))errors.push('引用未授权或不在本次上下文');
  if(c.evidenceIds.length+c.metricIds.length===0)errors.push('陈述没有依据');
  const referencedFacts=facts.filter(f=>(c.metricIds as unknown[]).includes(f.id)),referencedEvidence=evidence.filter(e=>(c.evidenceIds as unknown[]).includes(e.chunkId)),allowed=new Set<string>();
  for(const f of referencedFacts){
   if(f.value!==null)allowed.add(String(f.value));
   if(f.coverage!==undefined)allowed.add(String(f.coverage));
   if(f.definitionVersion!==undefined)allowed.add(String(f.definitionVersion));
   for(const n of numbers(f.text??''))allowed.add(n);
   for(const date of [f.windowStart,f.windowEnd,f.calculatedAt])for(const n of numbers(date??''))allowed.add(n);
   for(const limit of f.limitations)if(!c.limitations.includes(limit))errors.push('漏掉必需限制');
  }
  for(const e of referencedEvidence){for(const n of numbers(e.text))allowed.add(n);if(e.evidenceNature&&!c.limitations.includes(e.evidenceNature))errors.push('遗漏所引资料的证据性质与限制');}
  for(const n of numbers(c.text.replace(/\bO\d+\b/g,'')))if(!allowed.has(n))errors.push('数字与所引用证据不一致：'+n);
  if(referencedFacts.some(f=>f.status!=='usable')&&/正常|数据完整|可以确定/.test(c.text))errors.push('把数据不足改成确定或正常');
 }
 return {valid:errors.length===0,errors:[...new Set(errors)]};
}
