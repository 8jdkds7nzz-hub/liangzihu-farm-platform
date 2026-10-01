import { readApi } from '@/platform/api';
import { getAlert } from '@/modules/alerts/service';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){const {id}=await context.params;return readApi(request,async(c,a)=>{await getAlert(c,a,id);const manages=['admin','owner','technician'].includes(a.role);return (await c.query(`SELECT i.id,i.channel,i.phase,i.level,i.state,i.started_at,i.error_code,u.display_name AS recipient_name,
    (SELECT connected FROM notification_receipts r WHERE r.intent_id=i.id AND r.connected IS NOT NULL ORDER BY r.recorded_at DESC LIMIT 1) AS connected
    FROM notification_intents i JOIN users u ON u.id=i.recipient_id WHERE i.alert_id=$1 AND ($2::boolean OR i.recipient_id=$3) ORDER BY i.created_at,i.id`,[id,manages,a.id])).rows;});}
