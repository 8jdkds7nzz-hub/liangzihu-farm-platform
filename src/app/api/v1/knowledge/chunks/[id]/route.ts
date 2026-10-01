import {readApi} from '@/platform/api';
import {getCitation} from '@/modules/knowledge/service';
export async function GET(r:Request,ctx:{params:Promise<{id:string}>}){const {id}=await ctx.params;return readApi(r,(c,a)=>getCitation(c,a,id));}
