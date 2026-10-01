import { readApi,writeApi } from '@/platform/api';
import { listMaintenance,recordMaintenance,recordManualCheck } from '@/modules/maintenance/records';
import { choice } from '@/platform/validation';
export function GET(request:Request){return readApi(request,listMaintenance);}
export function POST(request:Request){return writeApi(request,(c,a,b)=>choice(b.kind,['maintenance','manual'] as const,'记录类别')==='manual'?recordManualCheck(c,a,b):recordMaintenance(c,a,b),201);}
