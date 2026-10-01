import { readApi } from '@/platform/api';
import { pagination } from '@/platform/validation';
import { listAlerts } from '@/modules/alerts/service';
export function GET(request:Request){return readApi(request,(c,a)=>{const p=pagination(new URL(request.url));return listAlerts(c,a,p.limit,p.offset);});}
