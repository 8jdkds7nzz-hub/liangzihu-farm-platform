import type { ReadingInput } from './types';
export function canUseAsCurrent(x:ReadingInput,current:string|null,now:Date,maxAgeMs:number):boolean {
  if(x.quality!=='valid'||x.value===null||!Number.isFinite(x.value)||!x.sampledAt||x.origin==='manual')return false;
  const sampled=Date.parse(x.sampledAt),age=now.getTime()-sampled;
  return Number.isFinite(sampled)&&age>=0&&age<=maxAgeMs&&(current===null||sampled>Date.parse(current));
}
export function freshness(sampledAt:string|null,quality:string|null,now:Date,maxAgeMs:number|null) {
  if(maxAgeMs===null)return 'unconfigured';
  if(!sampledAt)return 'missing';
  if(quality!=='valid')return 'suspect';
  const age=now.getTime()-Date.parse(sampledAt);return age<0?'suspect':age>maxAgeMs?'stale':'fresh';
}
