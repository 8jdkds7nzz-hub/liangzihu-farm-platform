import {request as httpsRequest} from 'node:https';
import {lookup} from 'node:dns/promises';
import {BlockList,isIP} from 'node:net';
import type {IncomingMessage,ClientRequest} from 'node:http';
import type {RequestOptions} from 'node:https';
import {AppError} from '../../platform/error';
import {createWriteStream} from 'node:fs';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
export const REMOTE_MEDIA_MAX_BYTES=20*1024*1024;
export interface DownloadSettings{allowedHosts:string[];maxBytes?:number;timeoutMs?:number}
export interface DownloadDependencies{
 resolver?:(hostname:string)=>Promise<{address:string;family:number}[]>;
 requester?:(url:URL,options:RequestOptions,callback:(response:IncomingMessage)=>void)=>ClientRequest;
}
const fail=(code:string)=>new AppError(422,code,'远程原件读取未完成，请核对链接、网络及文件；临时链接未输出');
export function allowedMediaHosts(env:NodeJS.ProcessEnv=process.env){const hosts=(env.MEDIA_IMPORT_ALLOWED_HOSTS??'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);if(hosts.some(h=>!validHost(h)))throw new AppError(503,'MEDIA_REMOTE_HOSTS','原件下载域名配置无效');return [...new Set(hosts)];}
function validHost(h:string){return h.length<=253&&h.includes('.')&&h.split('.').every(s=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(s))&&!isIP(h);}
export function validateRemoteUrl(value:string,hosts:string[]):URL{
 let u:URL;try{if(value.length>8192)throw new Error();u=new URL(value);}catch{throw fail('MEDIA_REMOTE_URL');}
 if(u.protocol!=='https:'||u.port||u.username||u.password||u.hash||!validHost(u.hostname)||!hosts.includes(u.hostname))throw fail('MEDIA_REMOTE_URL');return u;
}
const blocked=new BlockList();
for(const [net,prefix]of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]as const)blocked.addSubnet(net,prefix,'ipv4');
const globalV6=new BlockList();globalV6.addSubnet('2000::',3,'ipv6');
for(const [net,prefix]of [['2001::',23],['2001:db8::',32],['2002::',16]]as const)blocked.addSubnet(net,prefix,'ipv6');
export function publicAddress(r:{address:string;family:number}){return isIP(r.address)===r.family&&(r.family===4?!blocked.check(r.address,'ipv4'):r.family===6&&globalV6.check(r.address,'ipv6')&&!blocked.check(r.address,'ipv6'));}
function read(url:URL,address:{address:string;family:number},maxBytes:number,signal:AbortSignal,requester:NonNullable<DownloadDependencies['requester']>):Promise<{bytes?:Buffer;redirect?:string}>{
 return new Promise((resolve,reject)=>{
 const req=requester(url,{agent:false,rejectUnauthorized:true,servername:url.hostname,headers:{'Accept-Encoding':'identity'},lookup:(_host,options,callback)=>{if(options.all)callback(null,[address]);else callback(null,address.address,address.family);}},res=>{
 const status=res.statusCode??0;if([301,302,303,307,308].includes(status)){const location=res.headers.location;res.destroy();if(!location)reject(fail('MEDIA_REMOTE_REDIRECTS'));else resolve({redirect:location});return;}
 if(status!==200){res.destroy();reject(fail('MEDIA_REMOTE_HTTP'));return;}
 if(res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'){res.destroy();reject(fail('MEDIA_REMOTE_ENCODING'));return;}
 const length=res.headers['content-length'];if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>maxBytes||Number(length)<1)){res.destroy();reject(fail('MEDIA_REMOTE_SIZE'));return;}
 let size=0;const chunks:Buffer[]=[];res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>maxBytes){res.destroy();reject(fail('MEDIA_REMOTE_SIZE'));}else chunks.push(chunk);});
 res.on('aborted',()=>reject(fail('MEDIA_REMOTE_TRUNCATED')));res.on('error',()=>reject(fail('MEDIA_REMOTE_NETWORK')));res.on('end',()=>{if(res.complete===false||(length!==undefined&&size!==Number(length)))reject(fail('MEDIA_REMOTE_TRUNCATED'));else if(!size)reject(fail('MEDIA_REMOTE_SIZE'));else resolve({bytes:Buffer.concat(chunks,size)});});
 });
 const abort=()=>req.destroy(fail('MEDIA_REMOTE_TIMEOUT'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();req.on('error',()=>reject(fail(signal.aborted?'MEDIA_REMOTE_TIMEOUT':'MEDIA_REMOTE_NETWORK')));req.on('close',()=>signal.removeEventListener('abort',abort));req.end();
 });
}
export async function downloadRemoteMedia(value:string,settings:DownloadSettings,deps:DownloadDependencies={}):Promise<Buffer>{
 const max=settings.maxBytes??REMOTE_MEDIA_MAX_BYTES,timeout=settings.timeoutMs??20000;if(!Number.isInteger(max)||max<1||max>REMOTE_MEDIA_MAX_BYTES||!Number.isInteger(timeout)||timeout<1||timeout>20000)throw fail('MEDIA_REMOTE_LIMITS');
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(fail('MEDIA_REMOTE_TIMEOUT'));},timeout);});
 const work=(async()=>{let url=validateRemoteUrl(value,settings.allowedHosts);for(let redirects=0;redirects<=3;redirects++){
 const addresses=await(deps.resolver??(h=>lookup(h,{all:true})))(url.hostname);if(controller.signal.aborted)throw fail('MEDIA_REMOTE_TIMEOUT');if(!addresses.length||addresses.some(r=>!publicAddress(r)))throw fail('MEDIA_REMOTE_ADDRESS');
 const result=await read(url,addresses[0],max,controller.signal,deps.requester??httpsRequest);if(result.bytes)return result.bytes;if(redirects===3)throw fail('MEDIA_REMOTE_REDIRECTS');let next:string;try{next=new URL(result.redirect!,url).toString();}catch{throw fail('MEDIA_REMOTE_URL');}url=validateRemoteUrl(next,settings.allowedHosts);
 }throw fail('MEDIA_REMOTE_REDIRECTS');})();
 try{return await Promise.race([work,deadline]);}catch(e){throw e instanceof AppError?e:fail('MEDIA_REMOTE_NETWORK');}finally{clearTimeout(timer);}
}
export interface DownloadedFile{path:string;length:number;checksum:string}
function readFileResponse(url:URL,address:{address:string;family:number},path:string,max:number,signal:AbortSignal,requester:NonNullable<DownloadDependencies['requester']>):Promise<{file?:DownloadedFile;redirect?:string}>{
 return new Promise((resolve,reject)=>{const req=requester(url,{agent:false,rejectUnauthorized:true,servername:url.hostname,headers:{'Accept-Encoding':'identity'},lookup:(_h,o,cb)=>o.all?cb(null,[address]):cb(null,address.address,address.family)},res=>{const status=res.statusCode??0;if([301,302,303,307,308].includes(status)){const location=res.headers.location;res.destroy();if(location)resolve({redirect:location});else reject(fail('MEDIA_REMOTE_REDIRECTS'));return;}const declared=res.headers['content-length'];if(status!==200||res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'){res.destroy();reject(fail('MEDIA_REMOTE_HTTP'));return;}if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>max||Number(declared)<1)){res.destroy();reject(fail('MEDIA_REMOTE_SIZE'));return;}
 let size=0;const sha=createHash('sha256'),meter=new Transform({transform(bytes:Buffer,_encoding,done){size+=bytes.length;if(size>max){done(fail('MEDIA_REMOTE_SIZE'));return;}sha.update(bytes);done(null,bytes);}});void pipeline(res,meter,createWriteStream(/*turbopackIgnore: true*/ path,{flags:'wx',mode:0o600})).then(()=>{if(!size||res.complete===false||declared!==undefined&&size!==Number(declared))reject(fail('MEDIA_REMOTE_TRUNCATED'));else resolve({file:{path,length:size,checksum:sha.digest('hex')}});}).catch(e=>reject(e instanceof AppError?e:fail(signal.aborted?'MEDIA_REMOTE_TIMEOUT':'MEDIA_REMOTE_NETWORK')));
 });const abort=()=>req.destroy(fail('MEDIA_REMOTE_TIMEOUT'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();req.on('error',()=>reject(fail(signal.aborted?'MEDIA_REMOTE_TIMEOUT':'MEDIA_REMOTE_NETWORK')));req.on('close',()=>signal.removeEventListener('abort',abort));req.end();});
}
export async function downloadRemoteFile(value:string,path:string,settings:DownloadSettings,deps:DownloadDependencies={}):Promise<DownloadedFile>{
 const max=settings.maxBytes??2147483648,timeout=settings.timeoutMs??1200000;if(!Number.isSafeInteger(max)||max<1||max>10737418240||!Number.isInteger(timeout)||timeout<1||timeout>1200000)throw fail('MEDIA_REMOTE_LIMITS');const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(fail('MEDIA_REMOTE_TIMEOUT'));},timeout);});const work=(async()=>{let url=validateRemoteUrl(value,settings.allowedHosts);for(let redirects=0;redirects<=3;redirects++){const addresses=await(deps.resolver??(h=>lookup(h,{all:true})))(url.hostname);if(controller.signal.aborted)throw fail('MEDIA_REMOTE_TIMEOUT');if(!addresses.length||addresses.some(r=>!publicAddress(r)))throw fail('MEDIA_REMOTE_ADDRESS');const result=await readFileResponse(url,addresses[0],path,max,controller.signal,deps.requester??httpsRequest);if(result.file)return result.file;if(redirects===3)throw fail('MEDIA_REMOTE_REDIRECTS');url=validateRemoteUrl(new URL(result.redirect!,url).toString(),settings.allowedHosts);}throw fail('MEDIA_REMOTE_REDIRECTS');})();try{return await Promise.race([work,deadline]);}catch(e){throw e instanceof AppError?e:fail('MEDIA_REMOTE_NETWORK');}finally{clearTimeout(timer);}
}
