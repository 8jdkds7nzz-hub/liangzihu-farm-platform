import {readApi,writeApi} from '@/platform/api';import {listEzvizConnections,saveEzvizConnection} from '@/modules/connections/ezviz';
export const GET=(r:Request)=>readApi(r,listEzvizConnections);
export const POST=(r:Request)=>writeApi(r,saveEzvizConnection,200,64000);
