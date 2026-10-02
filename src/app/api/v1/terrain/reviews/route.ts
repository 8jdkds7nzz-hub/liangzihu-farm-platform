import {writeApi} from '@/platform/api';import {reviewTerrain} from '@/modules/terrain/review';export const POST=(r:Request)=>writeApi(r,reviewTerrain);
