import {readApi,writeApi} from '@/platform/api';
import {listDocuments,createDocument,reviewDocument} from '@/modules/knowledge/service';
const handlers={GET:(r)=>readApi(r,listDocuments),POST:(r)=>writeApi(r,createDocument,200,512000),PATCH:(r)=>writeApi(r,reviewDocument)} satisfies Record<string,(r:Request)=>Promise<Response>>;
export const GET=handlers.GET;
export const POST=handlers.POST;
export const PATCH=handlers.PATCH;
