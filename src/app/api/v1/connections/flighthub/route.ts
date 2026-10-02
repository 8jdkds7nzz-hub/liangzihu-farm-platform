import {readApi,writeApi} from '@/platform/api';import {listDjiConnections,saveDjiConnection} from '@/modules/connections/flighthub';
export const GET=(r:Request)=>readApi(r,listDjiConnections);export const POST=(r:Request)=>writeApi(r,saveDjiConnection);
