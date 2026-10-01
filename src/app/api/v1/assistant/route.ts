import {readApi,writeApi} from '@/platform/api';
import {listAssistant,requestAssistant} from '@/modules/assistant/service';
const handlers={GET:(r)=>readApi(r,listAssistant),POST:(r)=>writeApi(r,requestAssistant)} satisfies Record<string,(r:Request)=>Promise<Response>>;
export const GET=handlers.GET;
export const POST=handlers.POST;
