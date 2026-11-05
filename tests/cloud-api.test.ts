import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHandler } from '../supabase/functions/_shared/handler.ts';
const owner='11111111-1111-4111-8111-111111111111',stranger='22222222-2222-4222-8222-222222222222',booking='33333333-3333-4333-8333-333333333333';
const ownerToken='fixture.'+Buffer.from(JSON.stringify({session_id:booking})).toString('base64url')+'.fixture-signature';
function setup(options:{rate?:number;session?:boolean;rateError?:boolean;cron?:boolean;failedJob?:boolean;personalOnly?:boolean;personalUserId?:string;caller?:string;confirmed?:boolean;anonymous?:boolean;pinSet?:boolean;pinOk?:boolean;target?:unknown;quote?:unknown}={}){
  const calls:{name:string;args:Record<string,unknown>}[]=[];let verified=0;
  const control=()=>[{key:'scheduler',value:{enabled:true,lastTick:new Date().toISOString()}},{key:'dispatch',value:{failed:0,oldestDueSeconds:0}}];
  const admin={auth:{async getUser(token:string){verified++;return token===ownerToken?{data:{user:{id:options.caller||owner,email_confirmed_at:options.confirmed===false?null:'2026-10-13T00:00:00Z',is_anonymous:options.anonymous??false}},error:null}:{data:{user:null},error:{}};}},
    async rpc(name:string,args:Record<string,unknown>){calls.push({name,args});if(name==='web_rate_limit')return{data:options.rate??0,error:options.rateError?{message:'fixture outage'}:null};if(name==='web_session_active')return{data:options.session??true,error:null};if(name==='web_profile')return{data:{config:{openId:'synthetic-secret'},accountHash:'private-hash',target:options.target??null,quote:options.quote??null,pinSet:options.pinSet??false},error:null};if(name==='web_verify_pin')return{data:options.pinOk??true,error:null};if(name==='web_cron_authorized')return{data:options.cron??false,error:null};if(name==='web_claim_due')return{data:options.failedJob?[{id:booking}]:[],error:null};if(name==='web_cancel')return{data:args.p_user===owner&&args.p_id===booking,error:null};return{data:null,error:null};},
    from(table:string){const query={select(){return query;},eq(){return query;},order(){return query;},limit(){return Promise.resolve({data:table==='web_control'?control():[],error:null});},then(resolve:(v:unknown)=>void){resolve({data:table==='web_control'?control():[],error:null});}};return query;}};
  const handler=createHandler(admin as unknown as SupabaseClient,new Set(['https://app.example.test']),options,
    {checkReservation:async()=>({target:{device:'50359160',port:'07'},selected:{id:'full-stop',title:'充满自停 · 最长480分钟',maxMinutes:480,prepayCents:200}} as never)});
  const send=(action:string,body:unknown={},token=ownerToken,origin='https://app.example.test')=>handler(new Request('https://backend.example.test/functions/v1/web-api/'+action,{method:'POST',headers:{Authorization:'Bearer '+token,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)}));
  return{send,calls,get verified(){return verified;}};
}
test('forged bodies cannot choose an owner, and private account material is absent from state',async()=>{
  const f=setup();const response=await f.send('status',{user_id:stranger});assert.equal(response.status,200);
  const raw=await response.text();assert.ok(!raw.includes('synthetic-secret')&&!raw.includes('private-hash'));
  assert.equal(f.calls.find(c=>c.name==='web_profile')?.args.p_user,owner);assert.equal(f.verified,1);
});

test('campus accepts independent confirmed users and always scopes profiles, sessions and cancellation to each caller',async()=>{
  for(const caller of [owner,stranger]){
    const f=setup({caller});
    assert.equal((await f.send('status',{user_id:caller===owner?stranger:owner})).status,200);
    for(const name of ['web_profile','web_session_active','web_rate_limit'])assert.equal(f.calls.find(c=>c.name===name)?.args.p_user,caller);
    const cancel=await f.send('cancel',{id:booking,user_id:owner});
    assert.equal(cancel.status,caller===owner?200:409);
    assert.equal(f.calls.find(c=>c.name==='web_cancel')?.args.p_user,caller);
    assert.equal((await f.send('operations')).status,401);
  }
  const unconfirmed=setup({caller:stranger,confirmed:false});
  assert.equal((await unconfirmed.send('status')).status,401);
  assert.equal(unconfirmed.calls.length,0);
});

test('personal service accepts only its configured owner regardless of body and fails closed without configuration',async()=>{
  const own=setup({personalOnly:true,personalUserId:owner});
  assert.equal((await own.send('status',{user_id:stranger})).status,200);
  assert.equal(own.calls.find(c=>c.name==='web_profile')?.args.p_user,owner);
  const foreign=setup({personalOnly:true,personalUserId:stranger});
  assert.equal((await foreign.send('status',{user_id:stranger})).status,403);
  assert.equal((await foreign.send('reserve',{user_id:stranger})).status,403);
  assert.equal(foreign.calls.length,0);
  for(const personalUserId of [undefined,'invalid']){
    const missing=setup({personalOnly:true,personalUserId});
    assert.equal((await missing.send('status')).status,503);
    assert.equal((await missing.send('tick')).status,503);
    assert.equal(missing.verified,0);
  }
});

test('browser identities need no email but remain session-checked, owner-scoped and denied scheduler access',async()=>{
  for(const caller of [owner,stranger]){
    const f=setup({caller,anonymous:true,confirmed:false});
    assert.equal((await f.send('status',{user_id:caller===owner?stranger:owner})).status,200);
    for(const name of ['web_profile','web_session_active','web_rate_limit'])assert.equal(f.calls.find(c=>c.name===name)?.args.p_user,caller);
    assert.equal((await f.send('cancel',{id:booking,user_id:owner})).status,caller===owner?200:409);
    assert.equal((await f.send('operations')).status,401);
    assert.equal((await f.send('tick')).status,401);
    assert.ok(!f.calls.some(c=>c.name==='web_claim_due'));
  }
  const revoked=setup({anonymous:true,confirmed:false,session:false});
  assert.equal((await revoked.send('status')).status,401);
  assert.ok(!revoked.calls.some(c=>c.name==='web_profile'));
  const personal=setup({anonymous:true,confirmed:false,caller:stranger,personalOnly:true,personalUserId:owner});
  assert.equal((await personal.send('status')).status,403);
});

test('personal owner restriction preserves the separately authenticated unique scheduler',async()=>{
  const f=setup({personalOnly:true,personalUserId:owner,cron:true});
  assert.equal((await f.send('tick',{},'fixture-scheduler-secret')).status,200);
  assert.equal(f.verified,0);
  assert.equal(f.calls.filter(c=>c.name==='web_claim_due').length,1);
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

test('reservation PIN is required, verified before any platform read, and never echoed back',async()=>{
  const target={device:'50359160',port:'07'}, quote={fingerprint:'a'.repeat(64)};
  const body={idempotencyKey:booking,confirmedPlug:true,target,schemeId:'full-stop',quoteFingerprint:quote.fingerprint,
    scheduledAt:'2026-11-04T22:00:00.000Z',maxPrepayCents:200};
  const missing=setup({pinSet:true,target,quote});
  const blocked=await missing.send('reserve',body);
  assert.equal(blocked.status,409);assert.deepEqual(await blocked.json(),{error:'本浏览器已设置预约口令，请先输入6位口令。'});
  assert.ok(!missing.calls.some(c=>c.name==='web_verify_pin'||c.name==='web_reserve'));
  const short=setup({pinSet:true,target,quote});
  assert.equal((await short.send('reserve',{...body,pin:'12345'})).status,400);
  assert.ok(!short.calls.some(c=>c.name==='web_reserve'));
  const wrong=setup({pinSet:true,pinOk:false,target,quote});
  const rejected=await wrong.send('reserve',{...body,pin:'123456'});
  assert.equal(rejected.status,409);assert.deepEqual(await rejected.json(),{error:'预约口令不正确，请重新输入。'});
  assert.ok(!wrong.calls.some(c=>c.name==='web_reserve'));
  const accepted=setup({pinSet:true,target,quote});
  const response=await accepted.send('reserve',{...body,pin:'123456'});
  assert.equal(response.status,200);
  assert.equal(accepted.calls.find(c=>c.name==='web_verify_pin')?.args.p_user,owner);
  assert.equal(accepted.calls.find(c=>c.name==='web_reserve')?.args.p_pin,'123456');
  const raw=await response.text();
  assert.ok(!raw.includes('123456'));
  assert.equal(JSON.parse(raw).state.profile.pinSet,true);
});

test('PIN management stays owner-scoped, format-checked and limited on its own bucket',async()=>{
  const f=setup({pinSet:true});
  const saved=await f.send('setPin',{pin:'654321',currentPin:'123456'});
  assert.equal(saved.status,200);
  assert.deepEqual(f.calls.find(c=>c.name==='web_set_pin')?.args,{p_user:owner,p_pin:'654321',p_current:'123456'});
  assert.deepEqual(f.calls.filter(c=>c.name==='web_rate_limit').map(c=>c.args.p_bucket),['pin']);
  assert.equal((await f.send('setPin',{pin:'12345'})).status,400);
  assert.equal((await f.send('setPin',{pin:'654321',currentPin:'12'})).status,400);
  const cleared=await f.send('clearPin',{pin:'654321'});
  assert.equal(cleared.status,200);
  assert.deepEqual(f.calls.find(c=>c.name==='web_clear_pin')?.args,{p_user:owner,p_pin:'654321'});
  assert.equal((await f.send('clearPin',{})).status,400);
});

test('concurrent public health probes share one read and cannot retain stale readiness or bypass Origin',async()=>{
  let reads=0, release:()=>void=()=>{}, healthy=true, fail=false;
  const admin={from(){return {async select(){
    reads++; await new Promise<void>(resolve=>{release=resolve;});
    return {data:[{key:'scheduler',value:{enabled:healthy,lastTick:new Date().toISOString()}},
      {key:'dispatch',value:{failed:0,oldestDueSeconds:0}}],error:fail?{}:null};
  }}}};
  const handler=createHandler(admin as unknown as SupabaseClient,new Set(['https://app.example.test']));
  const get=(origin='https://app.example.test')=>handler(new Request('https://app.example.test/api/web/health',{headers:{Origin:origin}}));
  const wave=Array.from({length:100},()=>get());
  assert.equal(reads,1);
  assert.equal((await get('https://hostile.example.test')).status,403); assert.equal(reads,1);
  release(); assert.ok((await Promise.all(wave)).every(r=>r.status===200));
  healthy=false; const stopped=get(); assert.equal(reads,2); release(); assert.equal((await stopped).status,503);
  fail=true; const unavailable=get(); release(); assert.equal((await unavailable).status,503);
  healthy=true; fail=false; const recovered=get(); release(); assert.equal((await recovered).status,200);
  assert.equal(reads,4);
});
