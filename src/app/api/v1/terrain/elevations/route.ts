import {writeApi} from '@/platform/api';import {saveElevation} from '@/modules/terrain/survey';export const POST=(r:Request)=>writeApi(r,saveElevation);
