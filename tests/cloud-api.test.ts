import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHandler } from '../supabase/functions/_shared/handler.ts';
const owner='11111111-1111-4111-8111-111111111111',stranger='22222222-2222-4222-8222-222222222222',booking='33333333-3333-4333-8333-333333333333';
const ownerToken='fixture.'+Buffer.from(JSON.stringify({session_id:booking})).toString('base64url')+'.fixture-signature';
function setup(options:{rate?:number;session?:boolean;rateError?:boolean;cron?:boolean;failedJob?:boolean}={}){
  const calls:{name:string;args:Record<string,unknown>}[]=[];let verified=0;
  const admin={auth:{async getUser(token:string){verified++;return token===ownerToken?{data:{user:{id:owner,email_confirmed_at:'2026-10-13T00:00:00Z',is_anonymous:false}},error:null}:{data:{user:null},error:{}};}},
    async rpc(name:string,args:Record<string,unknown>){calls.push({name,args});if(name==='web_rate_limit')return{data:options.rate??0,error:options.rateError?{message:'fixture outage'}:null};if(name==='web_session_active')return{data:options.session??true,error:null};if(name==='web_profile')return{data:{config:{openId:'synthetic-secret'},accountHash:'private-hash',target:null,quote:null},error:null};if(name==='web_cron_authorized')return{data:options.cron??false,error:null};if(name==='web_claim_due')return{data:options.failedJob?[{id:booking}]:[],error:null};if(name==='web_cancel')return{data:args.p_user===owner&&args.p_id===booking,error:null};return{data:null,error:null};},
    from(table:string){const query={select(){return query;},eq(){return query;},order(){return query;},limit(){return Promise.resolve({data:table==='web_control'?[{key:'scheduler',value:{enabled:true}}]:[],error:null});},then(resolve:(v:unknown)=>void){resolve({data:table==='web_control'?[{key:'scheduler',value:{enabled:true}}]:[],error:null});}};return query;}};
  const handler=createHandler(admin as unknown as SupabaseClient,new Set(['https://app.example.test']));
  const send=(action:string,body:unknown={},token=ownerToken,origin='https://app.example.test')=>handler(new Request('https://backend.example.test/functions/v1/web-api/'+action,{method:'POST',headers:{Authorization:'Bearer '+token,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)}));
  return{send,calls,get verified(){return verified;}};
}
test('forged bodies cannot choose an owner, and private account material is absent from state',async()=>{
  const f=setup();const response=await f.send('status',{user_id:stranger});assert.equal(response.status,200);
  const raw=await response.text();assert.ok(!raw.includes('synthetic-secret')&&!raw.includes('private-hash'));
  assert.equal(f.calls.find(c=>c.name==='web_profile')?.args.p_user,owner);assert.equal(f.verified,1);
});
test('invalid user JWT, hostile origins and fake cron secrets cannot claim jobs',async()=>{
  const f=setup();assert.equal((await f.send('status',{},'forged-user-token')).status,401);
  assert.equal((await f.send('status',{},ownerToken,'https://evil.example.test')).status,403);
  assert.equal((await f.send('tick',{},'forged-cron-secret-value')).status,401);assert.ok(!f.calls.some(c=>c.name==='web_claim_due'));
});
test('cancel always uses the verified caller, even when a different owner is supplied in the body',async()=>{
  const f=setup();assert.equal((await f.send('cancel',{id:booking,user_id:stranger})).status,200);
  assert.equal(f.calls.find(c=>c.name==='web_cancel')?.args.p_user,owner);
});

test('rate limits return Retry-After before upstream reads and use a separate cancellation bucket',async()=>{
  const f=setup({rate:17});const result=await f.send('inspectTarget');
  assert.equal(result.status,429);assert.equal(result.headers.get('Retry-After'),'17');
  assert.ok(!f.calls.some(c=>c.name==='web_profile'));
  await f.send('cancel',{id:booking});
  assert.deepEqual(f.calls.filter(c=>c.name==='web_rate_limit').map(c=>c.args.p_bucket),['upstream','safety']);
  assert.ok(f.calls.filter(c=>c.name==='web_rate_limit').every(c=>c.args.p_user===owner));
});
test('expired sessions and unavailable shared limiter fail closed',async()=>{
  const expired=setup({session:false});assert.equal((await expired.send('cancel',{id:booking})).status,401);
  assert.ok(!expired.calls.some(c=>c.name==='web_cancel'||c.name==='web_rate_limit'));
  const unavailable=setup({rateError:true});assert.equal((await unavailable.send('inspectTarget')).status,503);
  assert.ok(!unavailable.calls.some(c=>c.name==='web_profile'));
});
test('diagnostics require the scheduler secret and failed jobs report 503 rather than a healthy tick',async()=>{
  const user=setup();assert.equal((await user.send('operations')).status,401);
  assert.ok(!user.calls.some(c=>c.name==='web_operations'));
  const cron=setup({cron:true,failedJob:true});const result=await cron.send('tick');
  assert.equal(result.status,503);assert.deepEqual(await result.json(),{claimed:1,processed:0,failed:1});
  assert.deepEqual(cron.calls.find(c=>c.name==='web_dispatch_report')?.args,{p_claimed:1,p_processed:0,p_failed:1});
});
