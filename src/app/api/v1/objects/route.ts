import { readApi,writeApi } from '@/platform/api';
import { pagination } from '@/platform/validation';
import { listObjects,saveObject } from '@/modules/registry/objects';
export function GET(request:Request){const url=new URL(request.url);return readApi(request,(c,a)=>{const p=pagination(url);return listObjects(c,a,p.limit,p.offset,url.searchParams.get('action')==='configure'?'configure':'read');});}
export function POST(request:Request){return writeApi(request,(c,a,b)=>saveObject(c,a,b),201);}
