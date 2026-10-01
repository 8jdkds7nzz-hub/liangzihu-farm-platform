import {readApi,writeApi} from '@/platform/api';
import {listCameraEvents,receiveCameraEvent,attachCameraImage} from '@/modules/cameras/service';
const handlers={GET:(r)=>readApi(r,listCameraEvents),POST:(r)=>writeApi(r,receiveCameraEvent),PATCH:(r)=>writeApi(r,attachCameraImage)} satisfies Record<string,(r:Request)=>Promise<Response>>;
export const GET=handlers.GET;
export const POST=handlers.POST;
export const PATCH=handlers.PATCH;
