import { readFile } from 'node:fs/promises';
const states={0:'free',1:'used',3:'fault'};
export async function fetchDevice(id) {
  const response=await fetch('http://www.szlzxn.cn/wxn/getDeviceInfo',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({areaId:'6',devaddress:String(id)}),signal:AbortSignal.timeout(4000)});
  if(!response.ok)throw new Error('设备暂不可连接');
  const result=await response.json();
  if(result.success!==true||!result.obj||typeof result.obj.portstatur!=='string'||!result.obj.portstatur||result.obj.portstatur.length>99)throw new Error('设备返回格式异常');
  return result.obj;
}
export async function nearbyStatus(stations,reader=fetchDevice) {
  const ids=[...new Set(stations.flatMap(s=>s.device_ids.map(String)))],results=new Map();
  let index=0;
  await Promise.all(Array.from({length:Math.min(8,ids.length)},async()=>{
    while(index<ids.length){const id=ids[index++];try{results.set(id,await reader(id));}catch{results.set(id,null);}}
  }));
  let failed=0;
  const output=stations.map(station=>{
    const devices=station.device_ids.map(raw=>{
      const id=String(raw),obj=results.get(id),counts={free:0,used:0,fault:0,other:0};
      const valid=obj&&typeof obj.portstatur==='string'&&obj.portstatur.length>0&&obj.portstatur.length<=99;
      const ports=valid?[...obj.portstatur].map(char=>states[char]||'other'):[];
      if(!valid)failed++;
      for(const port of ports)counts[port]++;
      const coordinate=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
      return {id,reachable:!!valid,error:valid?null:'设备暂不可连接',lon:coordinate(obj?.longitude),lat:coordinate(obj?.latitude),...counts,total:ports.length,ports};
    });
    const counts={free:0,used:0,fault:0,other:0};for(const device of devices)for(const key of Object.keys(counts))counts[key]+=device[key];
    return {name:station.name,lon:station.lon,lat:station.lat,aliases:station.aliases,...counts,total:devices.reduce((n,d)=>n+d.total,0),reachable:devices.some(d=>d.reachable),devices:devices.length,devices_detail:devices};
  });
  return {stations:output,updated_at:new Date().toISOString(),last_error:failed?`${failed} 台设备暂不可连接，空位统计未包含这些设备。`:null,fetching:false};
}
let cached=null, pending=null;
export async function publicStatus() {
  if(cached&&Date.now()-cached.at<15000)return cached.value;
  if(!pending)pending=(async()=>{
    const stations=JSON.parse(await readFile(new URL('./stations.json',import.meta.url),'utf8'));
    const value=await nearbyStatus(stations);cached={at:Date.now(),value};return value;
  })().finally(()=>{pending=null;});
  return pending;
}
export default async function handler(req,res) {
  if(!['GET','HEAD'].includes(req.method)){res.statusCode=405;res.setHeader('Allow','GET, HEAD');res.end();return;}
  try{const result=await publicStatus();res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','public, s-maxage=15, stale-while-revalidate=15');res.end(req.method==='HEAD'?undefined:JSON.stringify(result));}
  catch{res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'暂时无法读取空位，请稍后刷新。'}));}
}
