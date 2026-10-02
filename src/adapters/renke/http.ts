import {request} from 'node:https';
import {lookup} from 'node:dns/promises';
import {AppError} from '../../platform/error';
import {publicAddress,validateRemoteUrl} from '../../modules/media/remote-download';

export interface RenkeHttpContract {
  reference:string; verified:boolean; readOnlyConfirmed:boolean;
  url:string; allowedHost:string; method:'GET'|'POST';
  headers:Record<string,string>; parameters:Record<string,string>;
  cursorParameter:string; nextCursorPath:string; hasMorePath:string;
  minIntervalMs:number;
}
export function contractValue(value:unknown,path:string):unknown {
  if(!/^[a-zA-Z0-9_\u4e00-\u9fff.-]{1,200}$/.test(path)||path.split('.').some(k=>['__proto__','prototype','constructor'].includes(k)))throw new AppError(422,'RENKE_PATH','契约字段路径无效');
  return path.split('.').reduce<unknown>((v,k)=>v&&typeof v==='object'&&Object.hasOwn(v,k)?(v as Record<string,unknown>)[k]:undefined,value);
}
export function validateHttpContract(c:RenkeHttpContract){
  if(c.verified!==true||c.readOnlyConfirmed!==true||!c.reference||!['GET','POST'].includes(c.method)||!Number.isInteger(c.minIntervalMs)||c.minIntervalMs<1000||c.minIntervalMs>3600000)throw new AppError(503,'RENKE_HTTP_CONTRACT','须先核实只读接口、分页与限流契约');
  const u=validateRemoteUrl(c.url,[c.allowedHost]);if(u.search)throw new AppError(422,'RENKE_URL_PARAMS','参数须在契约参数表登记，地址不含查询凭据');
  if(!/^[a-zA-Z0-9_\u4e00-\u9fff]{1,80}$/.test(c.cursorParameter))throw new AppError(422,'RENKE_CURSOR','游标参数未核实');
  contractValue({},c.nextCursorPath);contractValue({},c.hasMorePath);
  for(const [name,ref]of Object.entries(c.headers))if(!/^[a-zA-Z0-9-]{1,80}$/.test(name)||['host','cookie','content-length','connection'].includes(name.toLowerCase())||!/^RENKE_CREDENTIAL_[A-Z0-9_]{1,60}$/.test(ref))throw new AppError(422,'RENKE_HEADERS','仅允许登记的服务器凭据引用');
  for(const [name,value]of Object.entries(c.parameters))if(!/^[a-zA-Z0-9_\u4e00-\u9fff]{1,80}$/.test(name)||typeof value!=='string'||value.length>1000||/token|secret|password|authorization/i.test(name))throw new AppError(422,'RENKE_PARAMETERS','业务参数无效，凭据只能放服务器请求头');
  return u;
}
export async function pullRenkePage(c:RenkeHttpContract,cursor:string|null,env:NodeJS.ProcessEnv=process.env){
  const u=validateHttpContract(c),headers:Record<string,string>={'Accept':'application/json','Accept-Encoding':'identity'},params={...c.parameters};if(cursor!==null)params[c.cursorParameter]=cursor;
  for(const [name,ref]of Object.entries(c.headers)){const secret=env[ref];if(!secret||/[\r\n]/.test(secret))throw new AppError(503,'RENKE_CREDENTIAL','只读凭据尚未部署');headers[name]=secret;}
  const body=c.method==='POST'?Buffer.from(JSON.stringify(params)):undefined;if(body){headers['Content-Type']='application/json';headers['Content-Length']=String(body.length);}else for(const [k,v]of Object.entries(params))u.searchParams.set(k,v);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
    const addresses=await lookup(u.hostname,{all:true});if(controller.signal.aborted||!addresses.length||addresses.some(x=>!publicAddress(x)))throw new AppError(422,'RENKE_HOST','只读接入必须指向登记的公网HTTPS域名');const address=addresses[0];
    return await new Promise<Buffer>((resolve,reject)=>{
      const failed=()=>reject(new AppError(502,'RENKE_HTTP_FAILED','只读拉取未完成，游标未推进；请核对接口与网络'));
      const req=request(u,{method:c.method,agent:false,rejectUnauthorized:true,servername:u.hostname,signal:controller.signal,headers,lookup:(_h,o,cb)=>o.all?cb(null,[address]):cb(null,address.address,address.family)},res=>{
        if(res.statusCode!==200||res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'){res.destroy();failed();return;}
        const declared=res.headers['content-length'];if(declared&&(!/^\d+$/.test(declared)||Number(declared)>1048576)){res.destroy();failed();return;}
        let size=0;const pieces:Buffer[]=[];res.on('data',(b:Buffer)=>{size+=b.length;if(size>1048576){res.destroy();failed();}else pieces.push(b);});res.on('aborted',failed);res.on('error',failed);res.on('end',()=>{if(!size||res.complete===false||declared&&size!==Number(declared))failed();else resolve(Buffer.concat(pieces,size));});
      });req.on('error',failed);req.end(body);
    });
  }finally{clearTimeout(timer);}
}
