import {readApi,writeApi} from '@/platform/api';import {getUpload,completeUpload} from '@/modules/media/uploads';
type Context={params:Promise<{id:string}>};
export async function GET(r:Request,ctx:Context){const {id}=await ctx.params;return readApi(r,(c,a)=>getUpload(c,a,id));}
export async function POST(r:Request,ctx:Context){const {id}=await ctx.params;return writeApi(r,(c,a,b)=>completeUpload(c,a,{...b,id}));}
