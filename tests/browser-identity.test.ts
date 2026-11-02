import test from 'node:test';
import assert from 'node:assert/strict';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { ensureBrowserIdentity, identityStorageKey } from '../src/lib/browser-identity.ts';

test('first-use identity coalesces creation, reuses old sessions and refuses to replace a lost identity',async()=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'window');
  const values=new Map<string,string>();
  Object.defineProperty(globalThis,'window',{configurable:true,value:{localStorage:{getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>values.set(key,value)}}});
  let session:Session|null=null,created=0,fail=false;
  const current={user:{id:'11111111-1111-4111-8111-111111111111',is_anonymous:true}} as Session;
  const client={auth:{async getSession(){return {data:{session},error:null}},async signInAnonymously(){created++;await new Promise(resolve=>setTimeout(resolve,10));if(fail)return {data:{session:null},error:{status:429}};session=current;return {data:{session},error:null}}}} as unknown as SupabaseClient;
  try{
    const sessions=await Promise.all(Array.from({length:20},()=>ensureBrowserIdentity(client)));
    assert.equal(created,1);assert.ok(sessions.every(s=>s.user.id===current.user.id));
    assert.equal(values.get(identityStorageKey),current.user.id);
    session={user:{id:'22222222-2222-4222-8222-222222222222',is_anonymous:false}} as Session;
    assert.equal((await ensureBrowserIdentity(client)).user.id,session.user.id);assert.equal(created,1);
    session=null;await assert.rejects(ensureBrowserIdentity(client),/原预约仍会执行|已生效预约仍会执行/);assert.equal(created,1);
    values.clear();fail=true;await assert.rejects(ensureBrowserIdentity(client),/稍后重试/);
    fail=false;assert.equal((await ensureBrowserIdentity(client)).user.id,current.user.id);assert.equal(created,3);
  }finally{if(original)Object.defineProperty(globalThis,'window',original);else Reflect.deleteProperty(globalThis,'window');}
});
