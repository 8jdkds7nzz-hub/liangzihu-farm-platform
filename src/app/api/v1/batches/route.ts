import { readApi,writeApi } from '@/platform/api';
import { listAccessibleObjects } from '@/modules/identity/access';
import { saveBatch } from '@/modules/registry/batches';
export function GET(request:Request){return readApi(request,async(c,a)=>{const ids=await listAccessibleObjects(c,a,'read');return (await c.query('SELECT * FROM production_batches WHERE object_id=ANY($1::uuid[]) ORDER BY started_at DESC LIMIT 200',[ids])).rows;});}
export function POST(request:Request){return writeApi(request,(c,a,b)=>saveBatch(c,a,b),201);}
