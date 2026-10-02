import {endpoint,assertOrigin} from '@/modules/identity/http';
import {requireActor} from '@/modules/identity/session';
import {database,transaction,getPool} from '@/db/pool';
import {streamMedia} from '@/modules/media/uploads';
import {Readable} from 'node:stream';
import {readMedia,uploadMedia} from '@/modules/media/service';
import {AppError} from '@/platform/error';
type Context={params:Promise<{id:string}>};
export async function GET(r:Request,ctx:Context){return endpoint(async()=>{const a=await requireActor(r),{id}=await ctx.params,file=await streamMedia(getPool(),a,id,r.headers.get('Range'));const headers:Record<string,string>={'Content-Type':String(file.asset.mime),'Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(String(file.asset.name))}`,'Content-Length':String(file.range.end-file.range.start+1),'Accept-Ranges':'bytes','Cache-Control':'no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Referrer-Policy':'no-referrer'};if(file.range.partial)headers['Content-Range']='bytes '+file.range.start+'-'+file.range.end+'/'+file.length;return new Response(Readable.toWeb(file.stream) as ReadableStream<Uint8Array>,{status:file.range.partial?206:200,headers});});}
export async function PUT(r:Request,ctx:Context){return endpoint(async()=>{assertOrigin(r);const a=await requireActor(r),{id}=await ctx.params,reader=r.body?.getReader();if(!reader)throw new AppError(400,'EMPTY_FILE','文件内容为空');let n=0;const parts:Uint8Array[]=[];try{while(true){const v=await reader.read();if(v.done)break;n+=v.value.length;if(n>20*1024*1024){await reader.cancel();throw new AppError(413,'FILE_TOO_LARGE','每个文件最多20MB');}parts.push(v.value);}}finally{reader.releaseLock();}return transaction(async c=>Response.json(await uploadMedia(c,a,id,Buffer.concat(parts)),{headers:{'Cache-Control':'no-store'}}));});}
