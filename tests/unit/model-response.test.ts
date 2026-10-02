import test from 'node:test';
import assert from 'node:assert/strict';
import {readModelBody} from '../../src/modules/assistant/provider';
test('T03模型头后正文超限/中断有界并保留未知状态',async()=>{
 const signal=new AbortController();
 assert.equal(await readModelBody(new Response('测试正文'),signal.signal),'测试正文');
 await assert.rejects(()=>readModelBody(new Response(new Uint8Array(400001)),signal.signal),{code:'MODEL_RESPONSE_TOO_LARGE'});
 const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode('{'));}}),pending=readModelBody(new Response(body),signal.signal);signal.abort();await assert.rejects(()=>pending,{code:'MODEL_TIMEOUT'});
});
