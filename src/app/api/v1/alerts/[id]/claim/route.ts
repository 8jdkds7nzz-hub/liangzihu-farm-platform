import { handleClaimRequest } from '@/modules/alerts/claims';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){const {id}=await context.params;return handleClaimRequest(request,id);}
