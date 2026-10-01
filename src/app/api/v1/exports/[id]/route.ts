import { endpoint } from '@/modules/identity/http';
import { requireActor } from '@/modules/identity/session';
import { transaction } from '@/db/pool';
import { downloadExport } from '@/modules/maintenance/exports';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){return endpoint(async()=>{const {id}=await context.params,actor=await requireActor(request);return transaction(async c=>{const file=await downloadExport(c,actor,id);return new Response(file.body,{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="farm-export-${id}.json"`,'Cache-Control':'no-store','Vary':'Cookie','X-Content-SHA256':file.sha256}});});});}
