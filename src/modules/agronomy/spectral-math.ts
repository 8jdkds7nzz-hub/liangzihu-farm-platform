import {AppError} from '../../platform/error';import {finite,integer,text,choice} from '../../platform/validation';
export function indexValue(nir:number,other:number):number|null{
 if(!Number.isFinite(nir)||!Number.isFinite(other)||nir<0||nir>1||other<0||other>1||nir+other===0)return null;return (nir-other)/(nir+other);
}
export function spectralConfig(b:Record<string,unknown>){
 const kind=choice(b.indexKind,['NDVI','NDRE'] as const,'指数'),raw=b.bands as Record<string,unknown>,cal=b.calibration as Record<string,unknown>;
 if(!raw||!cal||cal.state!=='reflectance')throw new AppError(400,'SPECTRAL_CALIBRATION','只计算有辐射校正依据的反射率产品，原始DN不能冒充反射率');
 const nir=integer(raw.nir,'NIR波段索引',0,15),other=integer(kind==='NDVI'?raw.red:raw.redEdge,kind==='NDVI'?'红波段索引':'红边波段索引',0,15);if(nir===other)throw new AppError(400,'SPECTRAL_BANDS','指数的两个波段必须不同');
 const scale=finite(cal.scale,'反射率比例'),offset=finite(cal.offset,'反射率偏移');if(scale<=0||scale>1||Math.abs(offset)>1)throw new AppError(400,'SPECTRAL_SCALE','比例须大于0且不大于1，偏移须在-1至1');
 if(!Array.isArray(b.breaks)||b.breaks.length>4)throw new AppError(400,'SPECTRAL_BREAKS','最多4个分界点对应5个分区');
 const breaks=b.breaks.map(v=>finite(v,'分界点'));if(breaks.some((v,i)=>v<=-1||v>=1||i>0&&v<=breaks[i-1]))throw new AppError(400,'SPECTRAL_BREAKS','分界点须在-1至1内严格递增');
 return {kind,nir,other,calibration:{state:'reflectance',scale,offset,evidence:text(cal.evidence,'辐射校正及比例依据',4000)},breaks};
}

