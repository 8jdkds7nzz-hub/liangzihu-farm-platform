import { readApi,writeApi } from '@/platform/api';
import { createExport } from '@/modules/maintenance/exports';
export function POST(request:Request){return writeApi(request,createExport,201);}
export function GET(request:Request){return readApi(request,async(c,a)=>(await c.query('SELECT id,object_ids,from_at,to_at,created_at,expires_at,sha256 FROM export_tasks WHERE created_by=$1 AND expires_at>clock_timestamp() ORDER BY created_at DESC LIMIT 100',[a.id])).rows);}
