import {writeApi} from '@/platform/api';import {terrainProfile} from '@/modules/terrain/links';export const POST=(r:Request)=>writeApi(r,terrainProfile);
