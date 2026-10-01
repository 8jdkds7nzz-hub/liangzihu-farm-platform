import {readApi,writeApi} from '@/platform/api';
import {listMap,saveBoundary,savePosition} from '@/modules/map/service';
const handlers={GET:(r)=>readApi(r,(c,a)=>listMap(c,a,new URL(r.url).searchParams.has('bbox')?new URL(r.url).searchParams.get('bbox')!.split(',').map(Number):undefined)),POST:(r)=>writeApi(r,(c,a,b)=>b.operation==='position'?savePosition(c,a,b):saveBoundary(c,a,b),200,512000)} satisfies Record<string,(r:Request)=>Promise<Response>>;
export const GET=handlers.GET;
export const POST=handlers.POST;
