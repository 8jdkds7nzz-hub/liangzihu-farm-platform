import {randomUUID} from 'node:crypto';import type {Pool} from 'pg';import type {Actor} from '../../src/platform/types';import sharp from 'sharp';import {writeArrayBuffer} from 'geotiff';
import {transaction} from '../../src/db/pool';import {prepareMedia,uploadMedia} from '../../src/modules/media/service';import {checksum,type PrivateStore} from '../../src/modules/media/storage';
export async function syntheticAsset(pool:Pool,a:Actor,objectId:string,store:PrivateStore,kind:'rgb'|'spectral'){
 const bytes=kind==='rgb'?await sharp({create:{width:32,height:32,channels:3,background:'#20b040'}}).png().toBuffer():Buffer.from(writeArrayBuffer(new Float32Array([.2,.6,0,0,.8,.2,.1,.9]),{width:2,height:2,BitsPerSample:[32,32],SampleFormat:[3,3],SamplesPerPixel:2,PhotometricInterpretation:1,ExtraSamples:[0],GeographicTypeGeoKey:4326,GTModelTypeGeoKey:2,GTRasterTypeGeoKey:1,ModelPixelScale:[.0001,.0001,0],ModelTiepoint:[0,0,0,114,30,0]}));
 const id=randomUUID();await transaction(async c=>{await prepareMedia(c,a,{objectId,assetId:id,requestKey:id,submissionId:id,name:kind==='rgb'?'合成像素.png':'合成反射率.tif',mime:kind==='rgb'?'image/png':'image/tiff',checksum:checksum(bytes),byteLength:bytes.length,capturedAt:new Date().toISOString(),source:'仅合成工程验证，不是农场影像'});await uploadMedia(c,a,id,bytes,store);},pool);return {id,bytes};
}

