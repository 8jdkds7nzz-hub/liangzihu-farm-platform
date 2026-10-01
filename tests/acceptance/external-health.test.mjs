import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { checkOnce } from '../../ops/external-health.mjs';
test('独立监测不查业务数据库；主入口停止后仍可向本机替身通道报告，受理不当作送达',async()=>{
  let notices=0;const sink=createServer((req,res)=>{notices++;res.writeHead(202);res.end();});sink.listen(0,'127.0.0.1');await once(sink,'listening');
  const app=createServer((req,res)=>{res.setHeader('content-type','application/json');res.end('{"ready":true}');});app.listen(0,'127.0.0.1');await once(app,'listening');
  const config={readyUrl:'http://127.0.0.1:'+app.address().port,token:'synthetic',alertUrl:'http://127.0.0.1:'+sink.address().port,allowSend:true};
  try{assert.equal((await checkOnce(config)).healthy,true);assert.equal(notices,0);await new Promise(resolve=>app.close(resolve));const result=await checkOnce(config);assert.equal(result.healthy,false);assert.equal(result.notification,'accepted');assert.equal(notices,1);}
  finally{app.close();await new Promise(resolve=>sink.close(resolve));}
});
