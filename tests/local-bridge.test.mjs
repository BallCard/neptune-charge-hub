import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer,request as httpRequest} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
test('local Windows proxy protects sessions, host and write origin and forwards only to an isolated fake',async()=>{
  if(process.platform!=='win32')return;
  const temp=await mkdtemp(join(tmpdir(),'neptune-bridge-')),calls=[];
  const fake=createServer(async(req,res)=>{
    if(req.url==='/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({app:'neptune-charge-ui'}));return;}
    if(req.url==='/'){res.end('<meta name="neptune-session" content="synthetic-token">');return;}
    assert.equal(req.headers['x-neptune-session'],'synthetic-token');
    let body='';for await(const chunk of req)body+=chunk;
    if(req.method==='POST'){assert.equal(req.headers.origin,`http://127.0.0.1:${fake.address().port}`);calls.push({path:req.url,body:JSON.parse(body)});}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({fake:true}));
  });
  await new Promise(resolve=>fake.listen(0,'127.0.0.1',resolve));
  const portProbe=createServer();await new Promise(resolve=>portProbe.listen(0,'127.0.0.1',resolve));const port=portProbe.address().port;await new Promise(resolve=>portProbe.close(resolve));
  await mkdir(join(temp,'.local'));await writeFile(join(temp,'.local/ui-connection.json'),JSON.stringify({url:`http://127.0.0.1:${fake.address().port}`}));
  const project=fileURLToPath(new URL('../',import.meta.url));
  const child=spawn(process.execPath,['scripts/serve-static.mjs'],{cwd:project,env:{...process.env,NEPTUNE_HUB_PORT:String(port),NEPTUNE_WINDOWS_ROOT:temp,NEPTUNE_ENABLE_WINDOWS:'1'},windowsHide:true,stdio:'ignore'});
  const origin=`http://127.0.0.1:${port}`;
  try{
    let ready=false;for(let i=0;i<30;i++){try{ready=(await fetch(origin+'/health')).ok;if(ready)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(ready,'fake bridge starts');
    const page=await fetch(origin+'/').then(r=>r.text()),token=page.match(/name="neptune-hub-session" content="([A-Za-z0-9_-]+)"/)?.[1];assert.ok(token);
    assert.equal((await fetch(origin+'/api/windows/state')).status,403);
    const wrongHost=await new Promise((resolve,reject)=>{const request=httpRequest(origin+'/',{headers:{Host:'evil.example'}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});request.on('error',reject);request.end();});
    assert.equal(wrongHost,403);
    const headers={'X-Neptune-Hub-Session':token,'Content-Type':'application/json',Origin:'https://evil.example'};
    assert.equal((await fetch(origin+'/api/windows/reserve',{method:'POST',headers,body:'{}'})).status,403);assert.equal(calls.length,0);
    assert.deepEqual(await fetch(origin+'/api/windows/state',{headers:{'X-Neptune-Hub-Session':token}}).then(r=>r.json()),{fake:true});
    const body={confirmedPlug:true,device:'12345678',port:'06',expectedAt:'2026-10-14T06:00:00+08:00'};
    assert.equal((await fetch(origin+'/api/windows/reserve',{method:'POST',headers:{...headers,Origin:origin},body:JSON.stringify(body)})).status,200);
    assert.deepEqual(calls,[{path:'/api/reserve',body}]);
    assert.equal((await fetch(origin+'/api/windows/charge',{method:'POST',headers:{...headers,Origin:origin},body:'{}'})).status,404);
  }finally{
    child.kill();await new Promise(resolve=>fake.close(resolve));
    const checked=resolve(temp);if(dirname(checked)!==resolve(tmpdir())||!basename(checked).startsWith('neptune-bridge-'))throw new Error('Unsafe cleanup path');
    await rm(checked,{recursive:true,force:true});
  }
});
