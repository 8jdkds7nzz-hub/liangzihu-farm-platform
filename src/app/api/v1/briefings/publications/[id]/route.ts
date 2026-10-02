import {readApi,writeApi} from '@/platform/api';
import {readPublication,revokePublication} from '@/modules/briefings/service';
export async function GET(r:Request,ctx:{params:Promise<{id:string}>}){const {id}=await ctx.params;return readApi(r,(c,a)=>readPublication(c,a,id));}
export async function PATCH(r:Request,ctx:{params:Promise<{id:string}>}){const {id}=await ctx.params;return writeApi(r,(c,a,b)=>revokePublication(c,a,{...b,id}));}
