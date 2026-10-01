import { readApi } from '@/platform/api';
import { assertAccess } from '@/modules/identity/access';
import { uuid } from '@/modules/identity/common';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){const {id}=await context.params;return readApi(request,async(c,a)=>{uuid(id);await assertAccess(c,a,{objectId:id,action:'read',at:new Date().toISOString()});return {
  object:(await c.query('SELECT id,code,name,kind,boundary_status,source,version FROM objects WHERE id=$1',[id])).rows[0],
  points:(await c.query(`SELECT DISTINCT p.id,p.name,p.code,p.metric,p.unit FROM points p JOIN devices d ON d.id=p.device_id
    WHERE d.object_id=$1 OR EXISTS(SELECT 1 FROM point_bindings b WHERE b.point_id=p.id AND b.object_id=$1 AND b.valid_from<=clock_timestamp() AND (b.valid_to IS NULL OR b.valid_to>clock_timestamp())) ORDER BY p.code LIMIT 200`,[id])).rows,
  alerts:(await c.query("SELECT id,title,state,severity FROM alerts WHERE object_id=$1 AND state<>'closed' ORDER BY opened_at DESC LIMIT 200",[id])).rows};});}
