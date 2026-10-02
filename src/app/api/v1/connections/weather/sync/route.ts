import {writeApi} from '@/platform/api';
import {requestSync} from '@/modules/connections/weather';
export const POST=(r:Request)=>writeApi(r,requestSync,202);
