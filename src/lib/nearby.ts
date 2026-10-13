import { z } from 'zod';
const count=z.number().int().nonnegative();
export const nearbySchema=z.object({stations:z.array(z.object({name:z.string().max(160),lon:z.number().finite(),lat:z.number().finite(),aliases:z.array(z.string()),free:count,used:count,fault:count,other:count,total:count,reachable:z.boolean(),devices:count,
  devices_detail:z.array(z.object({id:z.string().regex(/^\d{8}$/),reachable:z.boolean(),error:z.string().nullable(),lon:z.number().nullable(),lat:z.number().nullable(),free:count,used:count,fault:count,other:count,total:count,ports:z.array(z.enum(['free','used','fault','other'])).max(99)})).max(100)})).max(100),updated_at:z.string().datetime({offset:true}),last_error:z.string().nullable(),fetching:z.boolean()});
export type NearbyState=z.infer<typeof nearbySchema>;
export type Station=NearbyState['stations'][number];
export function bd09ToGcj02(lon:number,lat:number):[number,number] {
  const x=lon-.0065,y=lat-.006,pi=Math.PI;
  const radius=Math.sqrt(x*x+y*y)-.00002*Math.sin(y*pi*3000/180);
  const theta=Math.atan2(y,x)-.000003*Math.cos(x*pi*3000/180);
  return [radius*Math.cos(theta),radius*Math.sin(theta)];
}
export function wgs84ToGcj02(lon:number,lat:number):[number,number] {
  if(lon<72.004||lon>137.8347||lat<.8293||lat>55.8271)return[lon,lat];
  const x=lon-105,y=lat-35,pi=Math.PI;
  let dLat=-100+2*x+3*y+.2*y*y+.1*x*y+.2*Math.sqrt(Math.abs(x));
  dLat+=(20*Math.sin(6*x*pi)+20*Math.sin(2*x*pi))*2/3;
  dLat+=(20*Math.sin(y*pi)+40*Math.sin(y/3*pi))*2/3;
  dLat+=(160*Math.sin(y/12*pi)+320*Math.sin(y*pi/30))*2/3;
  let dLon=300+x+2*y+.1*x*x+.1*x*y+.1*Math.sqrt(Math.abs(x));
  dLon+=(20*Math.sin(6*x*pi)+20*Math.sin(2*x*pi))*2/3;
  dLon+=(20*Math.sin(x*pi)+40*Math.sin(x/3*pi))*2/3;
  dLon+=(150*Math.sin(x/12*pi)+300*Math.sin(x/30*pi))*2/3;
  const rad=lat/180*pi,magic=1-.00669342162296594323*Math.sin(rad)**2,sqrt=Math.sqrt(magic);
  return[lon+dLon*180/(6378245/sqrt*Math.cos(rad)*pi),lat+dLat*180/(6378245*(1-.00669342162296594323)/(magic*sqrt)*pi)];
}
export function metersBetween(a:[number,number],b:[number,number]) {
  const rad=(v:number)=>v*Math.PI/180;
  const h=Math.sin(rad(b[1]-a[1])/2)**2+Math.cos(rad(a[1]))*Math.cos(rad(b[1]))*Math.sin(rad(b[0]-a[0])/2)**2;
  return 6371000*2*Math.asin(Math.sqrt(Math.min(1,h)));
}
export function stationDistance(s:Station,fix:[number,number]|null) {return fix?metersBetween(wgs84ToGcj02(...fix),bd09ToGcj02(s.lon,s.lat)):Infinity;}
export function rankedStations(stations:Station[],fix:[number,number]|null) {
  return [...stations].sort((a,b)=>Number(b.reachable&&b.free>0)-Number(a.reachable&&a.free>0)||Number(b.reachable)-Number(a.reachable)||(fix?stationDistance(a,fix)-stationDistance(b,fix):0)||b.free-a.free||a.name.localeCompare(b.name,'zh-CN'));
}
export function navigationUrls(s:Pick<Station,'lon'|'lat'|'name'>) {
  const [lon,lat]=bd09ToGcj02(s.lon,s.lat);
  return {amap:`https://uri.amap.com/navigation?to=${lon.toFixed(6)},${lat.toFixed(6)},${encodeURIComponent(s.name)}&mode=walk&coordinate=gaode&callnative=1&src=neptune-hub`,baidu:`https://api.map.baidu.com/direction?destination=${encodeURIComponent(`latlng:${s.lat.toFixed(6)},${s.lon.toFixed(6)}|name:${s.name}`)}&mode=walking&output=html&coord_type=bd09ll&src=webapp.neptune.hub`};
}
