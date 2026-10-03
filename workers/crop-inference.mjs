import {pipeline,env,RawImage} from '@huggingface/transformers';
import sharp from 'sharp';
import {resolve} from 'node:path';
export const CROP_MODEL={id:'onnx-community/siglip2-base-patch16-224-ONNX',revision:'ba1f3b0843f24bc5417d38e19c37b287d719b2f4'};
const labels={canopy:'a crop field with standing green plants',lodging:'a crop field with fallen lodged plants',waterlogging:'a crop field flooded with standing water',bare:'bare soil without crops',unknown:'an unclear image not showing a crop field'};
env.cacheDir=resolve(process.env.MODEL_CACHE_ROOT??'.local/models');env.allowRemoteModels=process.argv.includes('--prepare');env.backends.onnx.wasm.numThreads=1;
const options={revision:CROP_MODEL.revision,dtype:'q8',device:'cpu',session_options:{intraOpNumThreads:1,interOpNumThreads:1}};
try{
 if(process.argv.includes('--prepare')){await pipeline('zero-shot-image-classification',CROP_MODEL.id,options);console.log(JSON.stringify({prepared:true,model:CROP_MODEL}));}
 else{
 let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>30*1024*1024)throw Error('INPUT_LIMIT');}
 const body=JSON.parse(input),bytes=Buffer.from(body.base64,'base64'),original=await sharp(bytes,{limitInputPixels:40000000}).metadata();
 const {data,info}=await sharp(bytes,{limitInputPixels:40000000}).rotate().resize({width:1024,height:1024,fit:'inside',withoutEnlargement:true}).flatten({background:'#fff'}).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
 let green=0,dark=0,clipped=0;const pixels=info.width*info.height;
 for(let i=0;i<data.length;i+=3){const r=data[i]/255,g=data[i+1]/255,b=data[i+2]/255;if(Math.max(r,g,b)<.05)dark++;if(Math.min(r,g,b)>.98)clipped++;if(2*g-r-b>.08&&g>r&&g>b)green++;}
 let candidates=null;
 if(body.evaluationMode===true){
 if(process.env.CROP_MODEL_EVALUATION_ENABLED!=='1')throw Error('EVALUATION_DISABLED');
 const model=await pipeline('zero-shot-image-classification',CROP_MODEL.id,options);
 // This pinned conversion keeps an unbounded tokenizer sentinel; SigLIP2 uses 64 tokens.
 model.tokenizer.model_max_length=64;
 const image=new RawImage(new Uint8ClampedArray(data),info.width,info.height,3),predictions=await model(image,Object.values(labels));
 candidates=predictions.map(p=>({label:Object.keys(labels).find(k=>labels[k]===p.label),score:p.score}));
 }
 console.log(JSON.stringify({method:'rgb-excess-green-v1',originalSize:[original.width,original.height],analysisSize:[info.width,info.height],pixels,greenFraction:green/pixels,darkFraction:dark/pixels,clippedFraction:clipped/pixels,model:body.evaluationMode?{...CROP_MODEL,textTokens:64,dtype:'q8',taxonomyVersion:'crop-taxonomy-v1'}:null,candidates,agronomicValidation:'not_validated',limitations:['绿色像素可能包含杂草或背景，不是作物长势或产量','候选匹配分数未经本场景概率校准；需独立现场标注','未验证病害或缺肥，不能据此生成剂量或动作']}));
 }
}catch{console.error('作物照片分析未完成，请核对原件、实验开关和本地模型。');process.exitCode=1;}
