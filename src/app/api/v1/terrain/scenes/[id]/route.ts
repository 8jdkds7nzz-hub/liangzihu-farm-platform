import {readApi} from '@/platform/api';import {terrainDetails} from '@/modules/terrain/details';
export async function GET(r:Request,ctx:{params:Promise<{id:string}>}){const {id}=await ctx.params;return readApi(r,(c,a)=>terrainDetails(c,a,id));}
