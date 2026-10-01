import {readApi,writeApi} from '@/platform/api';
import {listCalendars,saveCalendar,reviewCalendar} from '@/modules/calendars/service';
const handlers={GET:(r)=>readApi(r,listCalendars),POST:(r)=>writeApi(r,saveCalendar,200,512000),PATCH:(r)=>writeApi(r,reviewCalendar)} satisfies Record<string,(r:Request)=>Promise<Response>>;
export const GET=handlers.GET;
export const POST=handlers.POST;
export const PATCH=handlers.PATCH;
