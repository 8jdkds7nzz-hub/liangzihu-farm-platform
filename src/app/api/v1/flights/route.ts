import {readApi,writeApi} from '@/platform/api';
import {listFlights,importFlight,linkFlightAsset} from '@/modules/flights/service';
const handlers={GET:(r)=>readApi(r,listFlights),POST:(r)=>writeApi(r,importFlight,200,512000),PATCH:(r)=>writeApi(r,linkFlightAsset)} satisfies Record<string,(r:Request)=>Promise<Response>>;
export const GET=handlers.GET;
export const POST=handlers.POST;
export const PATCH=handlers.PATCH;
