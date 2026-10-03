import {readApi,writeApi} from '@/platform/api';import {AppError} from '@/platform/error';import {createProtectionPlan,protectionPlan} from '@/modules/protection/plans';import {createPrescription,reviewPrescription,prescriptionEvent,prescription} from '@/modules/protection/prescriptions';import {recordExecution} from '@/modules/protection/executions';import {importExecutions} from '@/modules/protection/imports';import {recordDelivery,recordFollowup} from '@/modules/protection/deliveries';import {protectionOverview,executionDetail} from '@/modules/protection/queries';
const handlers={plans:createProtectionPlan,prescriptions:createPrescription,'prescription-review':reviewPrescription,'prescription-events':prescriptionEvent,executions:recordExecution,imports:importExecutions,deliveries:recordDelivery,followups:recordFollowup};
type Ctx={params:Promise<{section:string}>};
export async function GET(r:Request,ctx:Ctx){const {section}=await ctx.params,u=new URL(r.url);return readApi(r,(c,a)=>{
 if(section==='overview')return protectionOverview(c,a,u.searchParams.get('objectId')??'');
 if(section==='plan')return protectionPlan(c,a,u.searchParams.get('id'));
 if(section==='execution')return executionDetail(c,a,u.searchParams.get('id')??'');
 if(section==='prescription')return prescription(c,a,u.searchParams.get('id'));
 throw new AppError(404,'PROTECTION_ENDPOINT','查询入口不存在');
});}
export async function POST(r:Request,ctx:Ctx){const {section}=await ctx.params;return writeApi(r,(c,a,b)=>{const fn=Object.hasOwn(handlers,section)?handlers[section as keyof typeof handlers]:null;if(!fn)throw new AppError(404,'PROTECTION_ENDPOINT','操作入口不存在');return fn(c,a,b);},200,2*1024*1024);}

