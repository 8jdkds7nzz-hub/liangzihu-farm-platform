import {readApi,writeApi} from '@/platform/api';
import {irrigationStep} from '@/modules/tasks/service';
const handlers={POST:(r)=>writeApi(r,irrigationStep)} satisfies Record<string,(r:Request)=>Promise<Response>>;
export const POST=handlers.POST;
