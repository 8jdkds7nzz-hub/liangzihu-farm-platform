import {readApi,writeApi} from '@/platform/api';import {saveCameraCapabilities,requestCameraRead,listCameraReads} from '@/modules/cameras/readonly';
export const GET=(r:Request)=>readApi(r,listCameraReads);
export const POST=(r:Request)=>writeApi(r,requestCameraRead);
export const PATCH=(r:Request)=>writeApi(r,saveCameraCapabilities);
