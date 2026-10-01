import { readApi,writeApi } from '@/platform/api';
import { listAccessibleObjects } from '@/modules/identity/access';
import { createWorkOrder,updateWorkOrder } from '@/modules/maintenance/work-orders';
export function GET(request:Request){return readApi(request,async(c,a)=>{const ids=await listAccessibleObjects(c,a,'read');return (await c.query('SELECT w.*,o.name AS object_name,u.display_name AS assignee_name FROM work_orders w JOIN objects o ON o.id=w.object_id LEFT JOIN users u ON u.id=w.assigned_to WHERE w.object_id=ANY($1::uuid[]) ORDER BY created_at DESC LIMIT 200',[ids])).rows;});}
export function POST(request:Request){return writeApi(request,createWorkOrder,201);}
export function PATCH(request:Request){return writeApi(request,updateWorkOrder);}
