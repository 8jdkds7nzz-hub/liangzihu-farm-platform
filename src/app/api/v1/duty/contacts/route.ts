import { readApi,writeApi } from '@/platform/api';
import { saveContact } from '@/modules/notifications/rosters';
import { requireAdmin } from '@/modules/identity/management';
export function POST(request:Request){return writeApi(request,saveContact);}
export function GET(request:Request){return readApi(request,async(c,a)=>{await requireAdmin(c,a);return (await c.query('SELECT c.user_id,c.channel,c.verified,c.updated_at,u.display_name FROM notification_contacts c JOIN users u ON u.id=c.user_id ORDER BY u.display_name')).rows;});}
