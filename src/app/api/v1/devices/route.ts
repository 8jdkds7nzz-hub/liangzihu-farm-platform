import { readApi,writeApi } from '@/platform/api';
import { pagination } from '@/platform/validation';
import { listDevices,saveDevice,verifyDevice } from '@/modules/registry/devices';
import { textField } from '@/modules/identity/http';
export function GET(request:Request){return readApi(request,(c,a)=>{const p=pagination(new URL(request.url));return listDevices(c,a,p.limit,p.offset);});}
export function POST(request:Request){return writeApi(request,(c,a,b)=>saveDevice(c,a,b),201);}
export function PATCH(request:Request){return writeApi(request,(c,a,b)=>verifyDevice(c,a,textField(b,'id'),textField(b,'evidence')));}
