import test from 'node:test';
import assert from 'node:assert/strict';
import {quantity,micros,decimal} from '../../src/modules/inventory/quantity';
test('3A数量六位定点、零值与未知分开，件数不得小数',()=>{
 assert.equal(quantity('0.000001'),'0.000001');
 assert.equal(quantity('0001.230000'),'1.23');
 assert.equal(decimal(micros('0.1')+micros('0.2')),'0.3');
 assert.equal(quantity(0),'0');
 for(const v of [null,undefined,'',NaN,Infinity,'1e3','-1','0.0000001','1000000001'])assert.throws(()=>quantity(v));
 assert.throws(()=>quantity('1.2','piece'));
});

