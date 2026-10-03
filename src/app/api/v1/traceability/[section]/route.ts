import {readApi,writeApi} from '@/platform/api';import {AppError} from '@/platform/error';
import {recordSample,recordTest,recordCredential,decideQuality} from '@/modules/traceability/quality';
import {traceLots,readTrace,exportTrace} from '@/modules/traceability/trace';import {openCase,caseEvent} from '@/modules/traceability/cases';import {draftCard,reviewCard} from '@/modules/traceability/public';import {qualityOverview} from '@/modules/traceability/queries';
const handlers={'query-export':exportTrace,samples:recordSample,tests:recordTest,credentials:recordCredential,decisions:decideQuality,queries:traceLots,cases:openCase,'case-events':caseEvent,cards:draftCard,'card-review':reviewCard};
type Context={params:Promise<{section:string}>};
export async function GET(r:Request,ctx:Context){const {section}=await ctx.params,url=new URL(r.url);return readApi(r,(c,a)=>{
 if(section==='overview')return qualityOverview(c,a,url.searchParams.get('objectId')??'');
 if(section==='query')return readTrace(c,a,url.searchParams.get('id')??'');
 throw new AppError(404,'TRACE_ENDPOINT','查询入口不存在');
});}
export async function POST(r:Request,ctx:Context){const {section}=await ctx.params;return writeApi(r,(c,a,b)=>{const fn=Object.hasOwn(handlers,section)?handlers[section as keyof typeof handlers]:null;if(!fn)throw new AppError(404,'TRACE_ENDPOINT','操作入口不存在');return fn(c,a,b);},200,262144);}

