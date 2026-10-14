import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchBatch, schedulerReady } from '../supabase/functions/_shared/dispatch.ts';
import type { CloudJob, JobStore } from '../supabase/functions/_shared/runner.ts';

test('bounded dispatch starts both jobs and records a failure without retrying either',async()=>{
  let started=0;let release:()=>void=()=>{};
  const gate=new Promise<void>(resolve=>release=resolve);
  const result=dispatchBatch([{id:'a'},{id:'b'}] as CloudJob[],{} as JobStore,async job=>{
    started++;if(started===2)release();await gate;if(job.id==='a')throw Error('fixture');
  });
  assert.deepEqual(await result,{claimed:2,processed:1,failed:1});assert.equal(started,2);
});
test('scheduler readiness requires completed healthy work, a recent clock and no old backlog',()=>{
  const now=Date.parse('2026-10-14T00:00:00Z');
  const c={scheduler:{enabled:true,lastTick:new Date(now-60000).toISOString()},dispatch:{failed:0,oldestDueSeconds:0}};
  assert.equal(schedulerReady(c,now),true);
  assert.equal(schedulerReady({...c,dispatch:{failed:1,oldestDueSeconds:0}},now),false);
  assert.equal(schedulerReady({...c,dispatch:{failed:0,oldestDueSeconds:120}},now),false);
  assert.equal(schedulerReady({scheduler:c.scheduler},now),false);
  assert.equal(schedulerReady(c,now+180000),false);
  assert.equal(schedulerReady(c,now-120000),false);
  assert.equal(schedulerReady({...c,scheduler:{...c.scheduler,enabled:false}},now),false);
});
