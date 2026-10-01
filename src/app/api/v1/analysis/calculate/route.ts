import {readApi,writeApi} from '@/platform/api';
import {calculateMetric} from '@/modules/analysis/service';
const handlers={POST:(r)=>writeApi(r,calculateMetric)} satisfies Record<string,(r:Request)=>Promise<Response>>;
export const POST=handlers.POST;
