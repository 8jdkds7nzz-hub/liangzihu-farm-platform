import { readApi } from '@/platform/api';
import { requireAdmin } from '@/modules/identity/management';
import { readiness } from '@/modules/operations/heartbeat';
export function GET(request:Request){return readApi(request,async(c,a)=>{await requireAdmin(c,a);return {...await readiness(c),backups:(await c.query('SELECT id,started_at,completed_at,latest_recoverable_at,state,checksum_passed,scope FROM backup_runs ORDER BY started_at DESC LIMIT 30')).rows,recovery:(await c.query('SELECT id,evidence,result,recorded_at FROM recovery_runs ORDER BY recorded_at DESC LIMIT 10')).rows};});}
