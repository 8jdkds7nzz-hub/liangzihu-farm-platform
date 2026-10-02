import {readApi,writeApi} from '@/platform/api';
import {listConnections,saveConnection} from '@/modules/connections/weather';
export const GET=(r:Request)=>readApi(r,listConnections);
export const POST=(r:Request)=>writeApi(r,saveConnection);
