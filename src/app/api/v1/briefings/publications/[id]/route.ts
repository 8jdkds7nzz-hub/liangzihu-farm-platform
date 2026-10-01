import {readApi} from '@/platform/api';
import {readPublication} from '@/modules/briefings/service';
export async function GET(r:Request,ctx:{params:Promise<{id:string}>}){const {id}=await ctx.params;return readApi(r,(c,a)=>readPublication(c,a,id));}
