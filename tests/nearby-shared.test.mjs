import assert from 'node:assert/strict';
import test from 'node:test';
import {sharedDeviceStatus,nearbyFromShared} from '../server/nearby-api.mjs';
const now=Date.parse('2026-10-15T00:00:00Z');
const fresh={updated_at:new Date(now-10000).toISOString(),devices:{'12345678':{devaddress:'12345678',portstatur:'0031',openId:'must-not-escape'}},pending:false};

test('shared reader waits for its first observation and sends only a fixed RPC',async()=>{
  let calls=0;
  const value=await sharedDeviceStatus('fixture-key',{now:()=>now,pause:async()=>{},fetcher:async(url,options)=>{
    assert.equal(url,'https://jozlxfxhtpximjcfrhya.supabase.co/rest/v1/rpc/web_nearby_status');
    assert.equal(options.redirect,'error');assert.equal(options.body,'{}');
    assert.equal(options.headers.Authorization,'Bearer fixture-key');
    return Response.json(++calls===1?{updated_at:null,devices:{},pending:true}:fresh);
  }});
  assert.equal(calls,2);assert.deepEqual(value,fresh);
});
test('shared reader rejects old or future observations and unavailable database',async()=>{
  for(const updated_at of [new Date(now-75000).toISOString(),new Date(now+6000).toISOString(),'bad']){
    await assert.rejects(sharedDeviceStatus('fixture-key',{now:()=>now,fetcher:async()=>Response.json({...fresh,updated_at})}),/not fresh/);
  }
  await assert.rejects(sharedDeviceStatus('',{fetcher:async()=>{throw Error('must not fetch');}}),/configuration/);
  await assert.rejects(sharedDeviceStatus('fixture-key',{fetcher:async()=>new Response('{}',{status:503})}),/unavailable/);
});
test('shared aggregation preserves observation age, excludes failed devices and strips extra fields',async()=>{
  const stations=[{name:'合成测试站点',device_ids:['12345678','87654321'],aliases:[],lon:120,lat:30}];
  const result=await nearbyFromShared(stations,fresh);
  assert.equal(result.updated_at,fresh.updated_at);assert.equal(result.stations[0].total,4);
  assert.equal(result.stations[0].devices_detail[1].reachable,false);
  assert.ok(!JSON.stringify(result).includes('must-not-escape'));
  const mismatched=await nearbyFromShared(stations,{...fresh,devices:{'12345678':{devaddress:'87654321',portstatur:'0000'}}});
  assert.equal(mismatched.stations[0].total,0);
});
