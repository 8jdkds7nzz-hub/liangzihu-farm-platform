import test from 'node:test';import assert from 'node:assert/strict';import {trackPoints,spraySegments} from '../../src/modules/protection/executions';
test('3C轨迹缺测不接线，启停和流量未知不当已喷施',()=>{
 const start='2026-10-03T00:00:00Z',end='2026-10-03T00:10:00Z',base={longitude:114,latitude:30,spraying:true,flow:2};
 const track=trackPoints([{...base,time:start},{...base,longitude:114.001,time:'2026-10-03T00:00:10Z'},{...base,flow:null,time:'2026-10-03T00:00:20Z'},{...base,time:end}],new Date(start).toISOString(),new Date(end).toISOString());
 assert.equal(spraySegments(track,30).segments.length,1);assert.equal(spraySegments(track,null).segments.length,0);
 assert.throws(()=>trackPoints([{...base,time:start},{...base,time:start}],start,end),{code:'TRACK_CONFLICT'});
});

