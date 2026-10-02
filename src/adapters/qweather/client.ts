import {createPrivateKey,sign} from 'node:crypto';
import {AppError} from '../../platform/error';
import {finite,integer,text,time} from '../../platform/validation';
export const QWEATHER_CONTRACT='qweather-weather-v1-daily-20261002';
export interface Credentials{privateKey:string;kid:string;iss:string;sub:string}
export interface Settings{host:string;latitude:number;longitude:number;days:number}
export interface Quantity{value:number;unit:string}
export interface Period{from:string;to:string;condition:string|null;temperatureMax:Quantity|null;temperatureMin:Quantity|null;windSpeed:Quantity|null;humidity:number|null;precipitation:{amount:Quantity|null;probability:number|null;type:string|null}|null}
export interface Daily{from:string;to:string;temperatureMax:Quantity|null;temperatureMin:Quantity|null;temperatureAvg:Quantity|null;daytime:Period;nighttime:Period}
export interface DailyResult{tag:string;attributions:string[];publishedAt:null;days:Daily[];raw:Buffer}
export function validateSettings(s:Settings):Settings{
 let u:URL;try{u=new URL(s.host);}catch{throw new AppError(400,'WEATHER_HOST','请输入天气服务控制台分配的HTTPS专用域名');}
 if(u.protocol!=='https:'||!/^[-a-z0-9]+\.qweatherapi\.com$/.test(u.hostname)||u.port||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new AppError(400,'WEATHER_HOST','只允许和风天气专用HTTPS域名，不能包含路径或凭据');
 const latitude=finite(s.latitude,'纬度'),longitude=finite(s.longitude,'经度');if(Math.abs(latitude)>90||Math.abs(longitude)>180||Number(latitude.toFixed(2))!==latitude||Number(longitude.toFixed(2))!==longitude)throw new AppError(400,'WEATHER_LOCATION','天气网格经纬度最多两位小数，请按来源核实位置');
 return {host:u.origin,latitude,longitude,days:integer(s.days,'预报天数',1,10)};
}
export function makeJwt(c:Credentials,at=new Date()){
 const kid=text(c.kid,'凭据标识',100),iss=text(c.iss,'开发者标识',100),sub=text(c.sub,'项目标识',100);let key;try{key=createPrivateKey(c.privateKey);}catch{throw new AppError(503,'WEATHER_CREDENTIALS','天气签名私钥无效，未输出内容');}
 if(key.asymmetricKeyType!=='ed25519')throw new AppError(503,'WEATHER_CREDENTIALS','天气签名必须使用Ed25519私钥');
 const iat=Math.floor(at.getTime()/1000)-30,encoded=[{alg:'EdDSA',kid},{iss,sub,iat,exp:iat+900}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');return encoded+'.'+sign(null,Buffer.from(encoded),key).toString('base64url');
}
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw new AppError(502,'WEATHER_SCHEMA','天气响应结构与已登记版本不一致');return v as Record<string,unknown>;}
function ratio(v:unknown){if(v===undefined||v===null)return null;const n=finite(v,'天气比例');if(n<0||n>1)throw new AppError(502,'WEATHER_SCHEMA','天气比例字段超出契约范围');return n;}
function quantity(v:unknown,unit:string):Quantity|null{if(v===undefined||v===null)return null;const q=object(v);if(q.unit!==unit)throw new AppError(502,'WEATHER_UNIT','天气字段单位不符，不自动转换');return {value:finite(q.value,'天气数值'),unit};}
function period(v:unknown):Period{if(v===undefined||v===null)return {from:'',to:'',condition:null,temperatureMax:null,temperatureMin:null,windSpeed:null,humidity:null,precipitation:null};const p=object(v),from=p.forecastStartTime?time(p.forecastStartTime):'',to=p.forecastEndTime?time(p.forecastEndTime):'';if((from==='')!==(to==='')||(from&&from>=to))throw new AppError(502,'WEATHER_INTERVAL','日夜预报时间区间无效');const condition=p.condition?object(p.condition):null,wind=p.wind?object(p.wind):null,precip=p.precipitation?object(p.precipitation):null;
 const amount=precip?quantity(precip.amount,'mm'):null,windSpeed=wind?quantity(wind.speed,'m/s'):null;if(windSpeed&&windSpeed.value<0)throw new AppError(502,'WEATHER_SCHEMA','风速不能为负数');if(amount&&amount.value<0)throw new AppError(502,'WEATHER_SCHEMA','降水量不能为负数');
 return {from,to,condition:condition?.text?text(condition.text,'天气现象',100):null,temperatureMax:quantity(p.temperatureMax,'°C'),temperatureMin:quantity(p.temperatureMin,'°C'),windSpeed,humidity:ratio(p.humidity),precipitation:precip?{amount,probability:ratio(precip.probability),type:precip.type?text(precip.type,'降水类别',40):null}:null};}
export function normalizeDaily(value:unknown):Omit<DailyResult,'raw'>{
 const b=object(value),m=object(b.metadata),tag=text(m.tag,'源数据标识',200);if(!Array.isArray(m.attributions)||m.attributions.length>20)throw new AppError(502,'WEATHER_SCHEMA','天气响应缺少归因数组');const attributions=m.attributions.map(v=>text(v,'源归因',1000));
 if(!Array.isArray(b.days)||b.days.length>10)throw new AppError(502,'WEATHER_SCHEMA','天气日预报列表无效');if(!b.days.length&&m.zeroResult!==true)throw new AppError(502,'WEATHER_SCHEMA','空预报须有明确的空数据标记');
 const days=b.days.map(v=>{const d=object(v),from=time(d.forecastStartTime),to=time(d.forecastEndTime);if(from>=to)throw new AppError(502,'WEATHER_INTERVAL','天气有效区间无效');const temperatureMax=quantity(d.temperatureMax,'°C'),temperatureMin=quantity(d.temperatureMin,'°C');if(temperatureMax&&temperatureMin&&temperatureMax.value<temperatureMin.value)throw new AppError(502,'WEATHER_SCHEMA','最高温度低于最低温度');return {from,to,temperatureMax,temperatureMin,temperatureAvg:quantity(d.temperatureAvg,'°C'),daytime:period(d.daytime),nighttime:period(d.nighttime)};}).sort((a,b)=>a.from.localeCompare(b.from));for(let i=1;i<days.length;i++)if(days[i].from<days[i-1].to)throw new AppError(502,'WEATHER_INTERVAL','天气预报区间重复或重叠');
 return {tag,attributions,publishedAt:null,days};
}
export async function readDaily(settings:Settings,credentials:Credentials,fetcher:typeof fetch=fetch):Promise<DailyResult>{
 const s=validateSettings(settings),url=new URL(`/weather/v1/daily/${s.latitude}/${s.longitude}`,s.host);url.searchParams.set('days',String(s.days));url.searchParams.set('localTime','false');url.searchParams.set('lang','zh');let response:Response;
 try{response=await fetcher(url,{method:'GET',headers:{Authorization:'Bearer '+makeJwt(credentials),'Accept':'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});}catch(e){if(e instanceof AppError)throw e;throw new AppError(503,'WEATHER_NETWORK_FAILED','天气请求失败或超时，未生成预报记录');}
 if(!response.ok)throw new AppError(503,response.status===429?'WEATHER_RATE_LIMITED':'WEATHER_HTTP_FAILED','天气服务拒绝请求，请核对账户与额度');
 if(!response.headers.get('content-type')?.toLowerCase().includes('application/json'))throw new AppError(502,'WEATHER_SCHEMA','天气响应不是JSON');const reader=response.body?.getReader();if(!reader)throw new AppError(502,'WEATHER_SCHEMA','天气响应为空');const parts:Uint8Array[]=[];let size=0;
 try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>512*1024){await reader.cancel();throw new AppError(502,'WEATHER_RESPONSE_TOO_LARGE','天气响应超过512KB');}parts.push(r.value);}}catch(e){if(e instanceof AppError)throw e;throw new AppError(503,'WEATHER_NETWORK_FAILED','天气响应读取未完成');}finally{reader.releaseLock();}
 const raw=Buffer.concat(parts);let body:unknown;try{body=JSON.parse(raw.toString('utf8'));}catch{throw new AppError(502,'WEATHER_SCHEMA','天气JSON不完整');}const normalized=normalizeDaily(body);if(normalized.days.length>s.days)throw new AppError(502,'WEATHER_SCHEMA','天气服务返回超出申请范围的预报');return {...normalized,raw};
}
export function configuredCredentials(env:NodeJS.ProcessEnv=process.env):Credentials{if(!env.QWEATHER_PRIVATE_KEY||!env.QWEATHER_KEY_ID||!env.QWEATHER_DEVELOPER_ID||!env.QWEATHER_PROJECT_ID)throw new AppError(503,'WEATHER_NOT_CONFIGURED','天气账户签名配置尚未齐备');return {privateKey:env.QWEATHER_PRIVATE_KEY,kid:env.QWEATHER_KEY_ID,iss:env.QWEATHER_DEVELOPER_ID,sub:env.QWEATHER_PROJECT_ID};}
