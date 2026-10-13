import assert from 'node:assert/strict';
import test from 'node:test';
import {bd09ToGcj02,wgs84ToGcj02,metersBetween,navigationUrls,rankedStations,nearbySchema,type Station} from '../src/lib/nearby';
test('BD-09 is converted for Gaode; Baidu retains the upstream coordinate system',()=>{
  const station={name:'测试站点',lon:120.13,lat:30.27};
  const converted=bd09ToGcj02(station.lon,station.lat);
  assert.ok(metersBetween([station.lon,station.lat],converted)>700);
  const urls=navigationUrls(station);
  assert.ok(urls.amap.includes(`${converted[0].toFixed(6)},${converted[1].toFixed(6)}`));
  assert.ok(decodeURIComponent(urls.baidu).includes('30.270000,120.130000'));
  assert.ok(urls.baidu.includes('coord_type=bd09ll'));
  assert.deepEqual(wgs84ToGcj02(0,0),[0,0]);
});
test('nearby ranking prefers a reachable free station over an offline or occupied nearer station',()=>{
  const station=(name:string,free:number,reachable:boolean,lon:number):Station=>({name,free,reachable,lon,lat:30.27,aliases:[],used:0,fault:0,other:0,total:free,devices:1,devices_detail:[]});
  const ranked=rankedStations([station('离线',10,false,120.13),station('占用',0,true,120.13),station('有空位',2,true,120.14)],[120.13,30.27]);
  assert.deepEqual(ranked.map(s=>s.name),['有空位','占用','离线']);
});
test('malformed nearby data cannot become actionable sockets',()=>{
  assert.throws(()=>nearbySchema.parse({stations:[{name:'bad',lon:NaN,lat:Infinity}],updated_at:'bad',last_error:null,fetching:false}));
});
