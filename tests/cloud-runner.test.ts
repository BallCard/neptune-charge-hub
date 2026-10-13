import test from 'node:test';
import assert from 'node:assert/strict';
import { runJob, type CloudJob, type JobStore, type ChargePlatform } from '../supabase/functions/_shared/runner.ts';
import { NeptuneError, type PreparedCharge } from '../src/lib/neptune.ts';
const now=Date.parse('2026-10-13T22:00:00Z');
function fixture(){
  const job:CloudJob={id:'fixture-job',phase:'checking',lease_token:'fixture-lease',scheduled_at:new Date(now).toISOString(),window_ends_at:new Date(now+600000).toISOString(),start_consumed_at:null,snapshot_cipher:'frozen',request_cipher:null};
  const prepared={version:1,config:{},target:{},payload:{},submitted:false,acknowledged:false,msgflag:null,verificationDisabled:false} as unknown as PreparedCharge;
  let consumed=false,starts=0,checks=0,failCommit=false;const finishes:{phase:string;due:string|null}[]=[];const tokens:(string|null)[]=[];
  const store:JobStore={async decrypt(value){return value==='frozen'?{config:{},target:{},schemeId:'full-stop',fingerprint:'fixture',maxPrepayCents:200}:structuredClone(prepared);},
    async consume(){if(consumed)return false;consumed=true;job.start_consumed_at=new Date(now).toISOString();job.phase='submitting';job.request_cipher='original';if(failCommit)throw Error('lost commit response');return true;},
    async finish(_job,phase,_message,p,due){if(p)Object.assign(prepared,structuredClone(p));job.phase=phase;finishes.push({phase,due});}};
  const platform:ChargePlatform={async prepare(){return structuredClone(prepared);},async submit(p){starts++;p.submitted=true;p.msgflag='original-token';return{status:'pending',msgflag:p.msgflag,message:'fixture'};},async verify(_p,token){checks++;tokens.push(token);return{confirmed:false,acknowledged:false,activeOrder:false,otherOrder:false,retryable:true};},async order(){return{any:false,matched:false,powerWatts:null};}};
  return{job,store,platform,finishes,tokens,set lostCommit(value:boolean){failCommit=value;},get starts(){return starts;},get checks(){return checks;}};
}
test('two deliveries race through one durable consume and only one starts charging',async()=>{
  const f=fixture();await Promise.all([runJob({...f.job},f.store,f.platform,()=>now),runJob({...f.job},f.store,f.platform,()=>now)]);assert.equal(f.starts,1);
});
test('a lost database commit reply never reaches the wire and recovery remains uncertain',async()=>{
  const f=fixture();f.lostCommit=true;await assert.rejects(runJob(f.job,f.store,f.platform,()=>now),/lost commit/);
  await runJob(f.job,f.store,f.platform,()=>now+120000);assert.equal(f.starts,0);assert.equal(f.job.phase,'uncertain');
});
test('recovered pending and uncertainty checks reuse the original token and never create a second request',async()=>{
  const f=fixture();await runJob(f.job,f.store,f.platform,()=>now);await runJob(f.job,f.store,f.platform,()=>now+180000);
  assert.equal(f.job.phase,'uncertain');await runJob(f.job,f.store,f.platform,()=>now+18*60000);
  assert.equal(f.starts,1);assert.deepEqual(f.tokens,['original-token','original-token']);assert.equal(f.finishes.at(-1)?.due,null);
});
test('cancellation or lease loss before consume suppresses the start request',async()=>{
  const f=fixture();f.store.consume=async()=>false;await runJob(f.job,f.store,f.platform,()=>now);assert.equal(f.starts,0);
});
test('late dispatch and changed fees stop without starting; closed hours only retry reads inside the window',async()=>{
  const late=fixture();await runJob(late.job,late.store,late.platform,()=>now+600001);assert.equal(late.job.phase,'missed');assert.equal(late.starts,0);
  const changed=fixture();changed.platform.prepare=async()=>{throw new NeptuneError('changed','prices');};await runJob(changed.job,changed.store,changed.platform,()=>now);assert.equal(changed.job.phase,'failed');assert.equal(changed.starts,0);
  const closed=fixture();closed.platform.prepare=async()=>{throw new NeptuneError('closed','closed');};await runJob(closed.job,closed.store,closed.platform,()=>now);assert.equal(closed.job.phase,'waiting');assert.equal(closed.finishes[0].due,new Date(now+60000).toISOString());assert.equal(closed.starts,0);
});
