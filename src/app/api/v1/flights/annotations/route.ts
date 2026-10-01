import {readApi,writeApi} from '@/platform/api';
import {annotateFlight} from '@/modules/flights/service';
const handlers={POST:(r)=>writeApi(r,annotateFlight)} satisfies Record<string,(r:Request)=>Promise<Response>>;
export const POST=handlers.POST;
