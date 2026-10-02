import {bindExpertPhone,bindWecomMember} from '@/modules/identity/sms';
import {requireActor} from '@/modules/identity/session';
import {assertOrigin,endpoint,json,readJson} from '@/modules/identity/http';
import {transaction} from '@/db/pool';
export async function POST(req:Request){return endpoint(async()=>{assertOrigin(req);const a=await requireActor(req),b=await readJson(req);return transaction(async c=>json(b.kind==='wecom'?await bindWecomMember(c,a,b):await bindExpertPhone(c,a,b)));});}
