import {readApi,writeApi} from '@/platform/api';
import {recordFieldSample,labelSample} from '@/modules/image-review/service';
const handlers={POST:(r)=>writeApi(r,recordFieldSample),PATCH:(r)=>writeApi(r,labelSample)} satisfies Record<string,(r:Request)=>Promise<Response>>;
export const POST=handlers.POST;
export const PATCH=handlers.PATCH;
