import {readApi} from '@/platform/api';
import {searchKnowledge} from '@/modules/knowledge/service';
import {embedTexts} from '@/modules/models/process';
import {requireActor} from '@/modules/identity/session';
import {endpoint} from '@/modules/identity/http';
export async function GET(r:Request){return endpoint(async()=>{await requireActor(r);const u=new URL(r.url),q=u.searchParams.get('q')??'',mode=u.searchParams.get('mode');let vector:number[]|undefined;if(q.length&&q.length<=2000&&mode!=='keyword'){try{vector=(await embedTexts([q]))[0];}catch{}}return readApi(r,(c,a)=>searchKnowledge(c,a,q,{vector,mode:mode==='keyword'?'keyword':mode==='vector'?'vector':'hybrid'}));});}
