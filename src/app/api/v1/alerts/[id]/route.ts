import { readApi } from '@/platform/api';
import { getAlert } from '@/modules/alerts/service';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){const {id}=await context.params;return readApi(request,(c,a)=>getAlert(c,a,id));}
