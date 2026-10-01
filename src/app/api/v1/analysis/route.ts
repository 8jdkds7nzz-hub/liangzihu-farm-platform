import {readApi,writeApi} from '@/platform/api';
import {listAnalysis,saveDefinition,reviewDefinition} from '@/modules/analysis/service';
const handlers={GET:(r)=>readApi(r,listAnalysis),POST:(r)=>writeApi(r,saveDefinition),PATCH:(r)=>writeApi(r,reviewDefinition)} satisfies Record<string,(r:Request)=>Promise<Response>>;
export const GET=handlers.GET;
export const POST=handlers.POST;
export const PATCH=handlers.PATCH;
