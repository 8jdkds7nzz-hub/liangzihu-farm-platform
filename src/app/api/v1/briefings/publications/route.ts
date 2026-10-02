import {readApi,writeApi} from '@/platform/api';
import {publishBriefing,listPublications} from '@/modules/briefings/service';
export const GET=(r:Request)=>readApi(r,listPublications);
const handlers={POST:(r)=>writeApi(r,publishBriefing)} satisfies Record<string,(r:Request)=>Promise<Response>>;
export const POST=handlers.POST;
