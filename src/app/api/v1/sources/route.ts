import { readApi,writeApi } from '@/platform/api';
import { listAccessibleObjects } from '@/modules/identity/access';
import { saveSource } from '@/modules/registry/devices';
export function GET(request:Request){return readApi(request,async(c,a)=>{const ids=await listAccessibleObjects(c,a,'configure');return (await c.query('SELECT id,object_id,code,name,provider,verified FROM data_sources WHERE object_id=ANY($1::uuid[]) ORDER BY code',[ids])).rows;});}
export function POST(request:Request){return writeApi(request,(c,a,b)=>saveSource(c,a,b),201);}
