import {readApi,writeApi} from '@/platform/api';
import {listRecords,submitRecord,reviewRecord} from '@/modules/records/service';
const handlers={GET:(r)=>readApi(r,(c,a)=>listRecords(c,a,new URL(r.url).searchParams.get('objectId')??undefined)),POST:(r)=>writeApi(r,submitRecord),PATCH:(r)=>writeApi(r,reviewRecord)} satisfies Record<string,(r:Request)=>Promise<Response>>;
export const GET=handlers.GET;
export const POST=handlers.POST;
export const PATCH=handlers.PATCH;
