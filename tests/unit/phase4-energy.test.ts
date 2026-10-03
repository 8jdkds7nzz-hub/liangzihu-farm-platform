import test from 'node:test';import assert from 'node:assert/strict';import {calculateEnergy} from '../../src/modules/energy/math';
const from='2026-10-03T00:00:00.000Z',to='2026-10-03T01:00:00.000Z';
const row=(id:string,at:string,value:string|null,extra={})=>({id,observed_at:at,value,quality:'valid',reset:false,...extra});
test('A42 空数据、零值、复位、无效中间观测及不完整边界不伪造耗电',()=>{
 assert.equal(calculateEnergy([],from,to,3600,true).energyKwh,null);
 assert.equal(calculateEnergy([row('a',from,'0'),row('b',to,'0')],from,to,3600,true).energyKwh,'0');
 for(const rows of [[row('a',from,'10'),row('b',to,'9')],[row('a',from,'10'),row('b',to,null)],[row('a',from,'10'),row('b','2026-10-03T00:30:00.000Z','11',{quality:'suspect'}),row('c',to,'12')]])assert.equal(calculateEnergy(rows,from,to,3600,true).complete,false);
 assert.equal(calculateEnergy([row('a',from,'1'),row('b',to,'2')],from,to,1800,true).energyKwh,null);
 assert.equal(calculateEnergy([row('a',from,'1'),row('b',to,'2')],from,to,3600,false).energyKwh,null);
 assert.equal(calculateEnergy([row('a','2026-10-03T00:01:00.000Z','1'),row('b',to,'2')],from,to,3600,true).energyKwh,null);
});
