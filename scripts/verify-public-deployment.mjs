import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, relative, sep } from 'node:path';

// Fixed production origin. All traffic is static, public reads or unauthenticated rejection probes.
const origin=process.env.NEPTUNE_VERIFY_ORIGIN||'https://neptune-charge-hub.vercel.app';
if(origin!=='https://neptune-charge-hub.vercel.app'&&!/^https:\/\/neptune-charge-[a-z0-9]+-ballcards-projects\.vercel\.app$/.test(origin))throw Error('Invalid verification origin');
const deployment=process.argv[3]||'';
if(deployment&&!/^dpl_[A-Za-z0-9]+$/.test(deployment))throw Error('Invalid deployment ID.');
// Exact reviewed Vercel opt-in toolbar shim; permit no other appended source.
const toolbar='\n'+String.raw`;(function(){try{if(typeof document==="undefined"||!/(?:^|;\s)__vercel_toolbar=1(?:;|$)/.test(document.cookie))return;}catch(e){return;}var s=document.createElement('script');s.src='https://vercel.live/_next-live/feedback/feedback.js';s.setAttribute("data-explicit-opt-in","true");s.setAttribute("data-cookie-opt-in","true");s.setAttribute("data-deployment-id","DEPLOYMENT_ID");((document.head||document.documentElement).appendChild(s))})();`.replace('DEPLOYMENT_ID',deployment);
const base=resolve('.local/static-deployment'),stage=resolve(process.argv[2]||'');
if(!stage.startsWith(base+sep))throw Error('Provide a screened deployment directory.');
const root=join(stage,'.vercel/output/static'),files=[];
const {edition}=JSON.parse(await readFile(join(root,'app-edition.json'),'utf8'));
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())await walk(path);else files.push(path);}}
await walk(root);
const digest=data=>createHash('sha256').update(data).digest('hex');
let index=0,checked=0,platformToolbarFiles=0;
await Promise.all(Array.from({length:4},async()=>{
  while(index<files.length){const file=files[index++],path=relative(root,file).split(sep).join('/');
    const response=await fetch(origin+'/'+path,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)});
    assert.equal(response.status,200,'static status: '+path);
    const remote=Buffer.from(await response.arrayBuffer()),local=await readFile(file);
    if(!remote.equals(local)&&deployment&&/^_next\/static\/chunks\/turbopack-[^/]+\.js$/.test(path)&&remote.subarray(0,local.length).equals(local)&&remote.subarray(local.length).toString()===toolbar)platformToolbarFiles++;
    else assert.equal(digest(remote),digest(local),'static mismatch: '+path);
    checked++;
  }
}));
const home=await fetch(origin+'/',{redirect:'error'});
assert.equal(home.status,200);assert.ok(home.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
assert.equal(home.headers.get('x-content-type-options'),'nosniff');
const healthResponse=await fetch(origin+'/api/web/health',{cache:'no-store',redirect:'error'});
assert.equal(healthResponse.status,200);const health=await healthResponse.json();assert.equal(health.schedulerReady,true);
const nearbyResponse=await fetch(origin+'/api/nearby',{cache:'no-store',redirect:'error'});
let nearby;
if(edition==='personal'){
  assert.equal(health.personalOnly,true,'server must enforce personal access');
  assert.equal(nearbyResponse.status,404,'personal service must not expose live nearby polling');
  const html=await home.text();assert.ok(html.includes('个人充电预约'));assert.ok(!html.includes('找空位')&&!html.includes('查空位'));
}else{
assert.equal(nearbyResponse.status,200);nearby=await nearbyResponse.json();assert.ok(Array.isArray(nearby.stations)&&nearby.stations.length>0);
assert.ok(nearby.stations.some(station=>station.devices_detail?.some(device=>device.reachable&&device.total>0)),
  'Public device reads returned no live sockets; station metadata and HTTP 200 do not prove availability.');
assert.ok(!JSON.stringify(nearby).includes('openId'));
}
for(const action of ['status','operations']){
  const result=await fetch(origin+'/api/web/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',redirect:'error'});
  assert.equal(result.status,401,'anonymous '+action);
}
const hostile=await fetch(origin+'/api/web/status',{method:'POST',headers:{Origin:'https://untrusted.example.invalid','Content-Type':'application/json'},body:'{}',redirect:'error'});
assert.equal(hostile.status,403);assert.equal(hostile.headers.get('access-control-allow-origin'),null);
for(const path of ['/.env','/api/windows/status','/native/windows/','/downloads/app.apk']){
  const result=await fetch(origin+path,{redirect:'error'});assert.equal(result.status,404,'private path: '+path);
}
console.log(JSON.stringify({result:'PASS',edition,staticFiles:checked,exactFiles:checked-platformToolbarFiles,platformToolbarFiles,health:true,stations:nearby?.stations.length,
  sockets:nearby?.stations.reduce((n,s)=>n+s.total,0),anonymousDenied:true,hostileOriginDenied:true,privatePathsDenied:true,chargingRequests:0}));
