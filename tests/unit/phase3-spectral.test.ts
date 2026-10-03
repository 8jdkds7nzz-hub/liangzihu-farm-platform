import test from 'node:test';import assert from 'node:assert/strict';import {indexValue,spectralConfig} from '../../src/modules/agronomy/spectral-math';
test('3C指数数值、零分母、无效反射率与最多五区',()=>{
 assert(Math.abs(indexValue(.6,.2)!-.5)<1e-12);assert.equal(indexValue(0,0),null);assert.equal(indexValue(2,.2),null);assert.equal(indexValue(NaN,.2),null);
 const b={indexKind:'NDVI',bands:{nir:1,red:0},calibration:{state:'reflectance',scale:1,offset:0,evidence:'合成'},breaks:[0,.3,.6,.8]};
 assert.equal(spectralConfig(b).breaks.length,4);assert.throws(()=>spectralConfig({...b,breaks:[.5,.1]}));assert.throws(()=>spectralConfig({...b,calibration:{...b.calibration,state:'DN'}}),{code:'SPECTRAL_CALIBRATION'});
});

