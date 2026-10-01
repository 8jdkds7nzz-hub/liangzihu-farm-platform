import { readApi,writeApi } from '@/platform/api';
import { listAccessibleObjects } from '@/modules/identity/access';
import { savePoint } from '@/modules/registry/points';
export function GET(request:Request){return readApi(request,async(c,a)=>{const ids=await listAccessibleObjects(c,a,'read');return (await c.query('SELECT p.*,d.object_id,d.name AS device_name FROM points p JOIN devices d ON d.id=p.device_id WHERE d.object_id=ANY($1::uuid[]) ORDER BY p.code',[ids])).rows;});}
export function POST(request:Request){return writeApi(request,(c,a,b)=>savePoint(c,a,b),201);}
