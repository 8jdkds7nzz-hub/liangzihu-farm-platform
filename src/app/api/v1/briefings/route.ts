import {readApi,writeApi} from '@/platform/api';
import {listBriefings,createBriefing,reviewItem} from '@/modules/briefings/service';
const handlers={GET:(r)=>readApi(r,listBriefings),POST:(r)=>writeApi(r,createBriefing),PATCH:(r)=>writeApi(r,reviewItem)} satisfies Record<string,(r:Request)=>Promise<Response>>;
export const GET=handlers.GET;
export const POST=handlers.POST;
export const PATCH=handlers.PATCH;
