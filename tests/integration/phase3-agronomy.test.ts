import {artifactPath} from '../support/artifacts';
import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {mkdtemp,rm,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {fromArrayBuffer} from 'geotiff';import {withDb} from '../support/db';import {actorFixture,objectFixture,permit} from '../support/fixtures';import {syntheticAsset} from '../support/agronomy';import {transaction} from '../../src/db/pool';import {localStore} from '../../src/modules/media/storage';import {queueCrop,runCrop,labelCrop} from '../../src/modules/agronomy/crops';import {queueSpectral,runSpectral} from '../../src/modules/agronomy/spectral';import {localAnalysis} from '../../src/modules/agronomy/process';import {createNotice,reviewNotice} from '../../src/modules/agronomy/notices';import {recordFlow} from '../../src/modules/agronomy/flows';
const key=()=>randomUUID(),now=()=>new Date().toISOString();
test('3C真实RGB和GeoTIFF后台解析、数值及私有成果回读，人工与机器分开',{timeout:120000},()=>withDb(async pool=>{
 const dir=await mkdtemp(join(tmpdir(),'agri-phase3-')),store=localStore(join(dir,'original'),join(dir,'backup'));
 try{const a=await actorFixture(pool,'technician'),reviewer=await actorFixture(pool,'technician'),o=await objectFixture(pool,a.id);for(const u of [a,reviewer])await permit(pool,u.id,o,['read','record','review']);
 const rgb=await syntheticAsset(pool,a,o,store,'rgb'),tif=await syntheticAsset(pool,a,o,store,'spectral'),tx=(fn:any)=>transaction<any>(fn,pool);
 const crop=await tx((c:any)=>queueCrop(c,a,{assetId:rgb.id,evaluationMode:false,requestKey:key()}));await runCrop(pool,crop.id,undefined,store);
 const cropRow=(await pool.query('SELECT * FROM crop_analyses WHERE id=$1',[crop.id])).rows[0];assert.equal(cropRow.state,'complete',cropRow.error_code);assert.equal(cropRow.result.greenFraction,1);assert.equal(cropRow.result.agronomicValidation,'not_validated');
 await tx((c:any)=>labelCrop(c,reviewer,{analysisId:crop.id,label:'unknown',evidence:'合成纯色不代表真实作物',observedAt:now(),requestKey:key()}));
 const product=await tx((c:any)=>queueSpectral(c,a,{assetId:tif.id,rawAssetIds:[rgb.id],capturedAt:now(),sourceRef:'合成2x2产品，原始航片未提供',processor:'合成生成器v1',indexKind:'NDVI',bands:{red:0,nir:1},calibration:{state:'reflectance',scale:1,offset:0,evidence:'已知合成像素'},breaks:[0,.6],requestKey:key()}));await runSpectral(pool,product.id,undefined,store);
 const r=(await pool.query('SELECT * FROM spectral_products WHERE id=$1',[product.id])).rows[0];assert.equal(r.state,'complete',r.error_code);assert.equal(r.result.validPixels,3);assert.equal(r.result.noDataPixels,1);assert(Math.abs(r.result.mean-(.5-.6+.8)/3)<1e-6);
 const asset=(await pool.query('SELECT * FROM media_assets WHERE id=$1',[r.index_asset_id])).rows[0],bytes=await store.get(asset.storage_key),read=await fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length) as ArrayBuffer),pixels=await(await read.getImage()).readRasters();
 assert(Math.abs(Number(pixels[0][0])-.5)<1e-6);assert.equal(pixels[0][1],-9999);
 const blocked=await tx((c:any)=>queueCrop(c,a,{assetId:rgb.id,evaluationMode:false,requestKey:key()}));await pool.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1',[a.id]);await runCrop(pool,blocked.id,undefined,store);assert.equal((await pool.query('SELECT state FROM crop_analyses WHERE id=$1',[blocked.id])).rows[0].state,'blocked');
 }finally{await rm(dir,{recursive:true,force:true});}
}));
test('3C固定版本SigLIP2实际本地候选推理，仅记工程链不冒称农业准确率',{timeout:180000},async()=>{
 const sharp=(await import('sharp')).default,bytes=await sharp({create:{width:32,height:32,channels:3,background:'#408040'}}).png().toBuffer(),old=process.env.CROP_MODEL_EVALUATION_ENABLED;
 process.env.CROP_MODEL_EVALUATION_ENABLED='1';try{const start=Date.now(),r=await localAnalysis('crop',{base64:bytes.toString('base64'),evaluationMode:true});
 assert.equal(r.candidates.length,5);assert(r.candidates.every((x:any)=>Number.isFinite(x.score)&&x.score>=0&&x.score<=1));assert.equal(r.model.revision,'ba1f3b0843f24bc5417d38e19c37b287d719b2f4');assert.equal(r.agronomicValidation,'not_validated');
 await writeFile(artifactPath('验收/3c/本地作物模型工程实测.json'),JSON.stringify({checkedAt:now(),input:'32x32合成纯色，不是现场样本',model:r.model,candidates:r.candidates,elapsedMs:Date.now()-start,agronomicValidation:r.agronomicValidation,remoteInference:false},null,2)+'\n');
 }finally{if(old===undefined)delete process.env.CROP_MODEL_EVALUATION_ENABLED;else process.env.CROP_MODEL_EVALUATION_ENABLED=old;}
});
test('3C农情通知独立审核及流量来源、未知与率定依据',()=>withDb(async pool=>{
 const a=await actorFixture(pool,'technician'),b=await actorFixture(pool,'technician'),o=await objectFixture(pool,a.id);for(const u of [a,b])await permit(pool,u.id,o,['read','record','review']);
 const tx=(fn:any)=>transaction<any>(fn,pool),t=now(),future=new Date(Date.now()+86400000).toISOString();
 const notice=await tx((c:any)=>createNotice(c,a,{objectId:o,title:'合成农情',agency:'合成来源',sourceRef:'仅测试，不是政府通知',publishedAt:t,validFrom:t,validUntil:future,crop:'水稻',region:'合成范围',body:'工程测试正文',requestKey:key()}));
 await assert.rejects(()=>tx((c:any)=>reviewNotice(c,a,{id:notice.id,action:'approve',evidence:'测试',requestKey:key()})),{code:'NOTICE_REVIEW'});
 await tx((c:any)=>reviewNotice(c,b,{id:notice.id,action:'approve',evidence:'合成复核',requestKey:key()}));
 const flow=await tx((c:any)=>recordFlow(c,a,{objectId:o,fromAt:t,toAt:t,value:null,unit:'m3/s',sourceKind:'measured',basisRef:'未取得实际读数',basisVersion:'测试v1',applicability:'仅工程测试',validUntil:future,requestKey:key()}));assert.equal(flow.value,null);
 await assert.rejects(()=>tx((c:any)=>recordFlow(c,a,{objectId:o,fromAt:t,toAt:t,value:'1',unit:'m3',sourceKind:'calibrated',basisRef:'',basisVersion:'v1',applicability:'合成',validUntil:future,requestKey:key()})),{status:400});
}));

