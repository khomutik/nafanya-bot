import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { startHealthServer } from '../src/health-server.mjs';
test('publication diagnostics require the existing secret and expose no write commands',async()=>{
  let inspections=0;
  const server=startHealthServer({healthHost:'127.0.0.1',healthPort:0,zoomBridgeSecret:'test-access'}, {snapshot:()=>({ok:true})}, {info(){}}, {inspect:async()=>{inspections++;return {publications:[]}}});
  await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base+'/publication-status')).status,401);
    assert.equal((await fetch(base+'/publication-status',{headers:{'x-nafanya-zoom-secret':'wrong-token'}})).status,401);
    assert.equal(inspections,0);
    assert.equal((await fetch(base+'/publication-status',{method:'POST',headers:{'x-nafanya-zoom-secret':'test-access'}})).status,404);
    const response=await fetch(base+'/publication-status',{headers:{'x-nafanya-zoom-secret':'test-access'}});
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{publications:[]});assert.equal(inspections,1);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
