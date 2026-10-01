import {readApi,writeApi} from '@/platform/api';
import {toTaskDraft} from '@/modules/briefings/service';
const handlers={POST:(r)=>writeApi(r,toTaskDraft)} satisfies Record<string,(r:Request)=>Promise<Response>>;
export const POST=handlers.POST;
