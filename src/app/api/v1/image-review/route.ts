import {readApi,writeApi} from '@/platform/api';
import {listImageReviews,queueReview} from '@/modules/image-review/service';
const handlers={GET:(r)=>readApi(r,listImageReviews),POST:(r)=>writeApi(r,queueReview)} satisfies Record<string,(r:Request)=>Promise<Response>>;
export const GET=handlers.GET;
export const POST=handlers.POST;
