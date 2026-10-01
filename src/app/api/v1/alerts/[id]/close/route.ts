import { writeApi } from '@/platform/api';
import { closeAlert } from '@/modules/alerts/claims';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){const {id}=await context.params;return writeApi(request,(c,a,b)=>closeAlert(c,a,id,b));}
