import {readApi,writeApi} from '@/platform/api';
import {saveModelPolicy} from '@/modules/assistant/service';
const handlers={POST:(r)=>writeApi(r,saveModelPolicy)} satisfies Record<string,(r:Request)=>Promise<Response>>;
export const POST=handlers.POST;
