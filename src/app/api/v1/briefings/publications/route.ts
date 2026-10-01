import {readApi,writeApi} from '@/platform/api';
import {publishBriefing} from '@/modules/briefings/service';
const handlers={POST:(r)=>writeApi(r,publishBriefing)} satisfies Record<string,(r:Request)=>Promise<Response>>;
export const POST=handlers.POST;
