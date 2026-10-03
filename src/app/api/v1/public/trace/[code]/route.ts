import {transaction} from '@/db/pool';import {endpoint,json} from '@/modules/identity/http';import {publicCard} from '@/modules/traceability/public';
export async function GET(_r:Request,ctx:{params:Promise<{code:string}>}){const {code}=await ctx.params;return endpoint(()=>transaction(async c=>{const r=json(await publicCard(c,code));r.headers.set('X-Robots-Tag','noindex, nofollow');return r;}));}

