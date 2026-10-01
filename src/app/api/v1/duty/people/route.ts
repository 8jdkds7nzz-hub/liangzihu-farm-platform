import { readApi } from '@/platform/api';
import { assertAccess } from '@/modules/identity/access';
import { uuid } from '@/modules/identity/common';
export function GET(request:Request){return readApi(request,async(c,a)=>{const objectId=new URL(request.url).searchParams.get('objectId');uuid(objectId);await assertAccess(c,a,{objectId,action:'configure',at:new Date().toISOString()});return (await c.query(`SELECT DISTINCT u.id,u.display_name,u.role FROM users u JOIN grants g ON g.user_id=u.id WHERE u.enabled AND g.object_id=$1 AND g.action='read' AND g.revoked_at IS NULL AND g.starts_at<=clock_timestamp() AND (g.expires_at IS NULL OR g.expires_at>clock_timestamp()) ORDER BY u.display_name`,[objectId])).rows;});}
