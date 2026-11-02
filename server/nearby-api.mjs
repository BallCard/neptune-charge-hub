import { readFile } from 'node:fs/promises';
import { nearbyStatus } from '../modules/nearby/status.mjs';

const endpoint='https://jozlxfxhtpximjcfrhya.supabase.co/rest/v1/rpc/web_nearby_status';
export async function sharedDeviceStatus(key,{fetcher=fetch,now=Date.now,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  if(!key)throw Error('Server configuration missing');
  const deadline=Date.now()+10000;
  for(let attempt=0;attempt<9;attempt++) {
    const remaining=deadline-Date.now();if(remaining<=0)break;
    const response=await fetcher(endpoint,{method:'POST',redirect:'error',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(Math.min(5000,remaining))});
    if(!response.ok)throw Error('Public device cache unavailable');
    const text=await response.text();if(text.length>100000)throw Error('Public device cache too large');
    const value=JSON.parse(text),age=now()-Date.parse(value.updated_at);
    if(Number.isFinite(age)&&age>=-5000&&age<=60000&&value.devices&&typeof value.devices==='object'&&!Array.isArray(value.devices))return value;
    if(!value.pending)break;
    await pause(750);
  }
  throw Error('Public device cache is not fresh');
}

export async function nearbyFromShared(stations,value) {
  const result=await nearbyStatus(stations,async id=>{
    const device=value.devices[id];
    if(!device||String(device.devaddress)!==id||typeof device.portstatur!=='string'||!device.portstatur||device.portstatur.length>99)throw Error('Device unavailable');
    return device;
  });
  // Preserve the upstream observation time; a cache read is not a new device read.
  result.updated_at=value.updated_at;
  return result;
}

let pending=null;
export default async function nearbyApi(req,res) {
  if(!['GET','HEAD'].includes(req.method)){res.statusCode=405;res.setHeader('Allow','GET, HEAD');res.end();return;}
  res.setHeader('Content-Type','application/json; charset=utf-8');
  try {
    if(!pending)pending=(async()=>{
      const stations=JSON.parse(await readFile(new URL('./stations.json',import.meta.url),'utf8'));
      return nearbyFromShared(stations,await sharedDeviceStatus(process.env.NEPTUNE_SUPABASE_SECRET));
    })().finally(()=>{pending=null;});
    const result=await pending;
    res.setHeader('Cache-Control','public, s-maxage=10');
    res.end(req.method==='HEAD'?undefined:JSON.stringify(result));
  }catch{
    res.statusCode=503;res.setHeader('Cache-Control','no-store');
    res.end(req.method==='HEAD'?undefined:JSON.stringify({error:'暂时无法读取空位，请稍后刷新。'}));
  }
}
