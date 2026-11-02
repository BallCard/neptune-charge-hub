import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createCozeServer} from '../server/coze-server.mjs';
import {createNodeWebApi,checkedOrigin} from '../server/web-api.ts';

test('Coze serves only screened assets and preserves API protection at the HTTP boundary',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'neptune-coze-'));
  await writeFile(join(directory,'index.html'),'<h1>fixture</h1>');await writeFile(join(directory,'404.html'),'not found');
  await writeFile(join(directory,'server.mjs'),'SYNTHETIC_PRIVATE_FILE');
  const calls=[];
  const admin={auth:{async getUser(){calls.push('getUser');return {data:{user:null},error:{message:'fixture'}};}}};
  const origin='https://migration.example.test';
  const server=createCozeServer({directory,manifest:{version:1,release:'fixture',cloudUrl:'https://aaaaaaaaaaaaaaaaaaaa.supabase.co',files:['index.html','404.html']},
    api:createNodeWebApi(admin,origin),nearby:async(_req,res)=>res.end('{"stations":[]}'),publicOrigin:origin});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();if(!address||typeof address==='string')throw Error('No HTTP address');
  const base='http://127.0.0.1:'+address.port;
  try{
    const home=await fetch(base+'/');assert.equal(home.status,200);assert.equal(await home.text(),'<h1>fixture</h1>');
    assert.equal(home.headers.get('x-content-type-options'),'nosniff');assert.ok(home.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
    for(const path of ['/server.mjs','/.env','/api/windows/status','/downloads/app.apk','/%2e%2e/server.mjs']){
      const r=await fetch(base+path);assert.equal(r.status,404);assert.ok(!(await r.text()).includes('SYNTHETIC_PRIVATE_FILE'));
    }
    const anonymous=await fetch(base+'/api/web/status',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
    assert.equal(anonymous.status,401);assert.equal(calls.length,0);
    const hostile=await fetch(base+'/api/web/status',{method:'POST',headers:{Origin:'https://evil.example.test',Authorization:'Bearer fixture-token-value','Content-Type':'application/json'},body:'{}'});
    assert.equal(hostile.status,403);assert.equal(hostile.headers.get('access-control-allow-origin'),null);assert.equal(calls.length,0);
    const forged=await fetch(base+'/api/web/status?action=tick',{method:'POST',headers:{Origin:origin,Authorization:'Bearer fixture-token-value','Content-Type':'application/json'},body:'{}'});
    assert.equal(forged.status,401);assert.deepEqual(calls,['getUser']);
    const oversized=await fetch(base+'/api/web/status',{method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(20001)});assert.equal(oversized.status,413);
  }finally{await new Promise(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
});

test('deployment origins cannot contain credentials, paths or arbitrary schemes',()=>{
  assert.equal(checkedOrigin('https://migration.example.test/'),'https://migration.example.test');
  for(const origin of ['http://migration.example.test','https://user:password@migration.example.test','https://migration.example.test/path','https://migration.example.test?redirect=evil','https://migration.example.test:8443'])assert.throws(()=>checkedOrigin(origin));
});
