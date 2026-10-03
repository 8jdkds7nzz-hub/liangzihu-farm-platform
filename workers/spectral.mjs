import {fromArrayBuffer,writeArrayBuffer} from 'geotiff';import sharp from 'sharp';import {spectralConfig,indexValue} from '../src/modules/agronomy/spectral-math.ts';
try{
 let text='';for await(const chunk of process.stdin){text+=chunk;if(text.length>96*1024*1024)throw Error('SPECTRAL_LIMIT');}const input=JSON.parse(text),config=spectralConfig(input),bytes=Buffer.from(input.base64,'base64');
 if(bytes.length>64*1024*1024)throw Error('SPECTRAL_LIMIT');
 const tiff=await fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),image=await tiff.getImage(),width=image.getWidth(),height=image.getHeight(),keys=image.getGeoKeys(),directory=image.getFileDirectory();
 if(width*height>4000000||width<1||height<1)throw Error('SPECTRAL_PIXELS');
 if(keys?.GeographicTypeGeoKey!==4326||keys?.ProjectedCSTypeGeoKey||keys?.GTRasterTypeGeoKey!==1||directory.hasTag('ModelTransformation'))throw Error('SPECTRAL_GRID');
 const origin=image.getOrigin(),resolution=image.getResolution(),bbox=image.getBoundingBox();
 if(resolution[0]<=0||resolution[1]>=0||bbox.some(x=>!Number.isFinite(x))||bbox[0]<-180||bbox[2]>180||bbox[1]<-90||bbox[3]>90)throw Error('SPECTRAL_GRID');
 if(Math.max(config.nir,config.other)>=image.getSamplesPerPixel())throw Error('SPECTRAL_BANDS');
 const bands=await image.readRasters({samples:[config.nir,config.other]}),nodata=image.getGDALNoData(),values=new Float32Array(width*height),rgba=Buffer.alloc(width*height*4),counts=Array(config.breaks.length+1).fill(0);
 const palette=[[177,73,47],[219,156,64],[198,202,99],[107,162,103],[39,105,81]];
 let valid=0,min=Infinity,max=-Infinity,sum=0;
 for(let i=0;i<values.length;i++){
 const n=bands[0][i],r=bands[1][i],bad=nodata!==null&&(Number.isNaN(nodata)?!Number.isFinite(n)||!Number.isFinite(r):n===nodata||r===nodata),v=bad?null:indexValue(n*config.calibration.scale+config.calibration.offset,r*config.calibration.scale+config.calibration.offset);
 if(v===null){values[i]=-9999;continue;}values[i]=v;valid++;sum+=v;min=Math.min(min,v);max=Math.max(max,v);const zone=config.breaks.filter(b=>v>=b).length;counts[zone]++;rgba.set([...palette[zone],255],i*4);
 }
 if(!valid)throw Error('SPECTRAL_NO_VALID_PIXELS');
 const output=writeArrayBuffer(values,{width,height,BitsPerSample:[32],SampleFormat:[3],SamplesPerPixel:1,PhotometricInterpretation:1,GeographicTypeGeoKey:4326,GTModelTypeGeoKey:2,GTRasterTypeGeoKey:1,ModelPixelScale:[resolution[0],-resolution[1],0],ModelTiepoint:[0,0,0,origin[0],origin[1],0],GDAL_NODATA:'-9999'});
 const preview=await sharp(rgba,{raw:{width,height,channels:4}}).resize({width:1024,height:1024,fit:'inside',withoutEnlargement:true}).png().toBuffer();
 console.log(JSON.stringify({result:{index:config.kind,width,height,bbox,crs:'EPSG:4326',validPixels:valid,noDataPixels:values.length-valid,validFraction:valid/values.length,min,max,mean:sum/valid,breaks:config.breaks,zones:counts.map((count,i)=>({class:i+1,count,fraction:count/valid})),algorithm:'reflectance-index-v1',limitations:['指数分区不直接诊断缺肥或病害','仅已声明校正的反射率产品，未独立验证厂家校正准确性','未提供独立云/阴影掩膜，相关像素须在上游设为无效值']},previewBase64:preview.toString('base64'),indexBase64:Buffer.from(output).toString('base64')}));
}catch(e){console.log(JSON.stringify({error:e?.code??(/^SPECTRAL_/.test(e?.message??'')?e.message:'SPECTRAL_DECODE')}));}

