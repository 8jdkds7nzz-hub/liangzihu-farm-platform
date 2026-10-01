import { writeApi } from '@/platform/api';
import { bindPoint } from '@/modules/registry/points';
export function POST(request:Request){return writeApi(request,(c,a,b)=>bindPoint(c,a,b),201);}
