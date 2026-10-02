import {writeApi} from '@/platform/api';import {createUpload} from '@/modules/media/uploads';
export const POST=(r:Request)=>writeApi(r,createUpload);
