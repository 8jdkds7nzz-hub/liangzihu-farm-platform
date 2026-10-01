import { writeApi } from '@/platform/api';
import { importDevices } from '@/modules/registry/import';
export function POST(request:Request){return writeApi(request,(c,a,b)=>importDevices(c,a,b.rows));}
