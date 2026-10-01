import {readApi,writeApi} from '@/platform/api';
import {listWeather,importWeather} from '@/modules/weather/service';
const handlers={GET:(r)=>readApi(r,listWeather),POST:(r)=>writeApi(r,importWeather)} satisfies Record<string,(r:Request)=>Promise<Response>>;
export const GET=handlers.GET;
export const POST=handlers.POST;
