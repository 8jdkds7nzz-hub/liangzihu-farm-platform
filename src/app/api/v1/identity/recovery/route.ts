import {writeApi} from '@/platform/api';import {authorizeRecovery} from '@/modules/identity/recovery';export const POST=(r:Request)=>writeApi(r,authorizeRecovery);
