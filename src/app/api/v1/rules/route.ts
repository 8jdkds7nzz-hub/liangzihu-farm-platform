import { readApi,writeApi } from '@/platform/api';
import { createRule,listRules,approveRule,enableRule } from '@/modules/alerts/rules';
import { choice,text,invalid } from '@/platform/validation';
export function GET(request:Request){return readApi(request,listRules);}
export function POST(request:Request){return writeApi(request,createRule,201);}
export function PATCH(request:Request){return writeApi(request,(c,a,b)=>{const op=choice(b.operation,['approve','enable'] as const,'操作');if(op==='approve')return approveRule(c,a,text(b.id,'规则ID'),text(b.evidence,'审核依据',2000));if(typeof b.enabled!=='boolean')invalid('启用状态须明确');return enableRule(c,a,text(b.id,'规则ID'),b.enabled);});}
