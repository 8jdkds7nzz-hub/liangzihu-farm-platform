import {readApi,writeApi} from '@/platform/api';
import {runReadTool} from '@/modules/assistant/service';
const handlers={POST:(r)=>writeApi(r,(c,a,b)=>runReadTool(c,a,String(b.name),b.args as Record<string,unknown>))} satisfies Record<string,(r:Request)=>Promise<Response>>;
export const POST=handlers.POST;
