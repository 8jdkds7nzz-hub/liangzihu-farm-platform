import {readApi,writeApi} from '@/platform/api';
import {prepareMedia} from '@/modules/media/service';
const handlers={POST:(r)=>writeApi(r,prepareMedia)} satisfies Record<string,(r:Request)=>Promise<Response>>;
export const POST=handlers.POST;
