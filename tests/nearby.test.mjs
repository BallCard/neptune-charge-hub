import assert from 'node:assert/strict';
import test from 'node:test';
import {nearbyStatus} from '../modules/nearby/status.mjs';
const station={name:'合成测试站点',lon:120.13,lat:30.27,device_ids:['12345678','87654321'],aliases:['测试']};
test('unreachable devices contribute no sockets and do not inherit counts from a previous device',async()=>{
  const calls=[];
  const result=await nearbyStatus([station],async id=>{calls.push(id);if(id==='87654321')throw Error('offline');return {portstatur:'0013x',longitude:'120.13',latitude:null,openId:'must-never-escape'};});
  assert.deepEqual(calls.sort(),station.device_ids.slice().sort());
  const s=result.stations[0];
  assert.equal(s.free,2);assert.equal(s.total,5);assert.equal(s.devices_detail[1].free,0);assert.equal(s.devices_detail[1].total,0);
  assert.equal(s.devices_detail[0].lat,null);assert.equal(s.devices_detail[0].other,1);
  assert.equal(result.last_error,'1 台设备暂不可连接，空位统计未包含这些设备。');
  assert.ok(!JSON.stringify(result).includes('must-never-escape'));
});
test('missing or empty status strings stay unreachable rather than showing available',async()=>{
  const result=await nearbyStatus([station],async id=>id==='12345678'?{}:{portstatur:''});
  assert.equal(result.stations[0].reachable,false);assert.equal(result.stations[0].free,0);assert.equal(result.stations[0].total,0);
});
