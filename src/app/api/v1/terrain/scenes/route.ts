import {readApi,writeApi} from '@/platform/api';import {listScenes,registerScene,withdrawScene} from '@/modules/terrain/scenes';
export const GET=(r:Request)=>readApi(r,listScenes);
export const POST=(r:Request)=>writeApi(r,registerScene,201,1048576);
export const PATCH=(r:Request)=>writeApi(r,withdrawScene);
