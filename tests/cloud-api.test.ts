import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHandler } from '../supabase/functions/_shared/handler.ts';
const owner='11111111-1111-4111-8111-111111111111',stranger='22222222-2222-4222-8222-222222222222',booking='33333333-3333-4333-8333-333333333333';
const ownerToken='fixture.'+Buffer.from(JSON.stringify({session_id:booking})).toString('base64url')+'.fixture-signature';
function setup(){
  const calls:{name:string;args:Record<string,unknown>}[]=[];let verified=0;
  const admin={auth:{async getUser(token:string){verified++;return token===ownerToken?{data:{user:{id:owner,email_confirmed_at:'2026-10-13T00:00:00Z',is_anonymous:false}},error:null}:{data:{user:null},error:{}};}},
    async rpc(name:string,args:Record<string,unknown>){calls.push({name,args});if(name==='web_session_active')return{data:true,error:null};if(name==='web_profile')return{data:{config:{openId:'synthetic-secret'},accountHash:'private-hash',target:null,quote:null},error:null};if(name==='web_cron_authorized')return{data:false,error:null};if(name==='web_cancel')return{data:args.p_user===owner&&args.p_id===booking,error:null};return{data:null,error:null};},
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
