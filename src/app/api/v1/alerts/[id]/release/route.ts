import { writeApi } from '@/platform/api';
import { releaseClaim } from '@/modules/alerts/claims';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){const {id}=await context.params;return writeApi(request,(c,a,b)=>releaseClaim(c,a,id,b));}
