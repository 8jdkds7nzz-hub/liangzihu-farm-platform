import { readApi } from '@/platform/api';
import { getPointHistory } from '@/modules/telemetry/queries';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
  const {id}=await context.params,url=new URL(request.url),at=new Date();
  return readApi(request,(c,a)=>getPointHistory(c,a,id,{from:url.searchParams.get('from')??new Date(at.getTime()-86400_000).toISOString(),to:url.searchParams.get('to')??at.toISOString(),cursor:url.searchParams.get('cursor'),limit:Number(url.searchParams.get('limit')??200)},at));
}
