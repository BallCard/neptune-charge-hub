import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';

// The dedicated migration site only; no booking, payment or scheduler execution.
const origin='https://xkrd9zr7b8.coze.site';
const base=resolve('.local/coze-deployment'),directory=resolve(process.argv[2]||'');
if(!directory.startsWith(base+sep))throw Error('Provide a screened Coze package directory');
const manifest=JSON.parse(await readFile(join(directory,'asset-manifest.json'),'utf8'));
const get=(path,options={})=>fetch(origin+path,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000),...options});
const healthResponse=await get('/health');assert.equal(healthResponse.status,200);
const health=await healthResponse.json();assert.equal(health.release,manifest.release);assert.equal(health.app,'neptune-charge-web');
let index=0,checked=0;
await Promise.all(Array.from({length:4},async()=>{
  while(index<manifest.files.length){
    const path=manifest.files[index++],response=await get('/'+path);
    assert.equal(response.status,200,path);
    assert.ok(Buffer.from(await response.arrayBuffer()).equals(await readFile(join(directory,'public',path))),'Asset changed: '+path);
    checked++;
  }
}));
const home=await get('/');assert.equal(home.status,200);
assert.ok(home.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
assert.equal(home.headers.get('x-content-type-options'),'nosniff');
for(const path of ['/server.mjs','/status.mjs','/stations.json','/asset-manifest.json','/.env','/api/windows/status','/downloads/app.apk'])assert.equal((await get(path)).status,404,path);
const post={method:'POST',headers:{'Content-Type':'application/json'},body:'{}'};
for(const action of ['status','operations'])assert.equal((await get('/api/web/'+action,post)).status,health.cloudConfigured?401:503,action);
if(health.cloudConfigured){
  const cloudHealth=await get('/api/web/health');assert.equal(cloudHealth.status,200);assert.equal((await cloudHealth.json()).schedulerReady,true);
  const hostile=await get('/api/web/status',{...post,headers:{...post.headers,Origin:'https://untrusted.example.invalid'}});
  assert.equal(hostile.status,403);assert.equal(hostile.headers.get('access-control-allow-origin'),null);
}
const nearbyResponse=await get('/api/nearby');assert.equal(nearbyResponse.status,200);
const nearby=await nearbyResponse.json();assert.equal(nearby.stations.length,14);
assert.ok(nearby.stations.some(station=>station.devices_detail?.some(device=>device.reachable&&device.total>0)),'No live sockets');
assert.ok(!JSON.stringify(nearby).includes('openId'));
console.log(JSON.stringify({result:'PASS',release:health.release,exactStaticFiles:checked,cloudConfigured:health.cloudConfigured,stations:nearby.stations.length,sockets:nearby.stations.reduce((n,s)=>n+s.total,0),privatePathsDenied:true,protectedApiDenied:true,chargingRequests:0}));
