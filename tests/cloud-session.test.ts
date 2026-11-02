import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudClient,cloudAction} from '../src/lib/cloud-executor.ts';
import {emptyWorkflow} from '../src/lib/workflow-types.ts';
test('a switched SDK session cannot transmit the previous account payment form',async()=>{
  const original=globalThis.fetch, owner='22222222-2222-4222-8222-222222222222';let apiCalls=0;
  const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const claims=Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600,sub:owner,role:'authenticated'})).toString('base64url');
  const token=header+'.'+claims+'.fixture-signature';
  globalThis.fetch=async(input)=>{const url=String(input);if(url==='/cloud-config.json')return Response.json({url:'https://aaaaaaaaaaaaaaaaaaaa.supabase.co',publishableKey:'sb_publishable_isolated_fixture'});
    if(url.includes('/auth/v1/token'))return Response.json({access_token:token,refresh_token:'fixture-refresh-token',token_type:'bearer',expires_in:3600,user:{id:owner,aud:'authenticated',role:'authenticated',email:'fixture@example.invalid'}});
    if(url==='/api/web/status'){apiCalls++;return Response.json({state:emptyWorkflow()});}throw Error('No other network request is allowed by this fixture');};
  let client:Awaited<ReturnType<typeof cloudClient>>=null;
  try {client=await cloudClient();assert.ok(client);const login=await client.auth.signInWithPassword({email:'fixture@example.invalid',password:'fixture-password'});assert.equal(login.error,null);
    await assert.rejects(cloudAction('configureAccount',{url:'private-fixture-never-real'},'11111111-1111-4111-8111-111111111111'),/身份已切换/);assert.equal(apiCalls,0);
    await cloudAction('status',{},owner);assert.equal(apiCalls,1);
  } finally {await client?.auth.stopAutoRefresh();globalThis.fetch=original;}
});
