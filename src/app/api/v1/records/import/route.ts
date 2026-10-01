import {readApi,writeApi} from '@/platform/api';
import {importRecords} from '@/modules/records/service';
const handlers={POST:(r)=>writeApi(r,importRecords,200,512000)} satisfies Record<string,(r:Request)=>Promise<Response>>;
export const POST=handlers.POST;
