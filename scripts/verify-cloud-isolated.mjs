import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

// No ports, no network, no real credentials. Never accepts a remote database URL.
const name = 'neptune-audit-' + randomUUID().slice(0, 8);
const image = 'pgvector/pgvector:pg16';
function command(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', chunk => out += chunk);
    child.stderr.on('data', chunk => err += chunk);
    child.on('error', reject);
    child.stdin.on('error', () => {});
    child.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(err || out || `docker exit ${code}`)));
    child.stdin.end(input);
  });
}
const sql = (query, database = 'postgres') => command(['exec', '-i', name, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database], query);
const uid = i => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const target = i => JSON.stringify({ device: String(10000000 + i), port: '01' });
const config = i => JSON.stringify({ synthetic: true, fixture: i });
const snapshot = i => JSON.stringify({ config: JSON.parse(config(i)), fingerprint: 'fixture' });
const scheme = JSON.stringify({ id: 'fixture', title: 'isolated', maxMinutes: 120 });
const reserve = (i, id = i, when = "date_trunc('hour',now())+interval '2 hours'", socket = i) =>
  `select public.web_reserve('${uid(i)}','${uid(10000 + id)}',${when},'${target(socket)}','${scheme}',200,'${snapshot(i)}');`;
let assertions = 0;
async function equal(query, expected, db) { assert.equal(await sql(query, db), expected); assertions++; }
async function burst(label, count, fn) {
  const times = [];
  const results = await Promise.allSettled(Array.from({ length: count }, async (_, i) => {
    const start = performance.now();
    try { return await fn(i); } finally { times.push(performance.now() - start); }
  }));
  times.sort((a,b) => a-b);
  console.log(JSON.stringify({ scenario: label, requests: count, fulfilled: results.filter(x=>x.status==='fulfilled').length,
    p95LocalProcessMs: Math.round(times[Math.ceil(count * .95)-1]) }));
  return results;
}

try {
  await command(['run','--rm','-d','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust',image]);
  let ready = false;
  for (let i=0;i<30;i++) { try { await sql('select 1;'); ready = true; break; } catch { await new Promise(r=>setTimeout(r,500)); } }
  assert.ok(ready, 'isolated PostgreSQL failed to start');
  await sql(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key); create table auth.sessions(id uuid primary key,user_id uuid);
    create schema extensions; create extension pgcrypto with schema extensions;
    create schema vault; create table vault.secrets(id uuid default gen_random_uuid(),name text,secret text);
    create view vault.decrypted_secrets as select name,secret as decrypted_secret from vault.secrets;
    create function vault.create_secret(s text,n text) returns uuid language sql as $$ insert into vault.secrets(name,secret) values(n,s) returning id $$;
    create schema net; create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$ begin raise exception 'NETWORK_DISABLED_IN_ISOLATED_TEST'; end $$;
    create sequence net.fixture_requests;
    create table net.http_request_queue(id bigint,url text,params jsonb);
    create table net._http_response(id bigint,status_code integer,content text);
    create function net.http_get(url text,params jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$
      declare id bigint:=nextval('net.fixture_requests'); begin
      if url<>'https://www.szlzxn.cn/wxn/getDeviceInfo' or params->>'areaId'<>'6' then raise exception 'UNEXPECTED_DESTINATION'; end if;
      insert into net.http_request_queue values(id,url,params);return id;end $$;
    grant usage on schema net to service_role;grant usage on sequence net.fixture_requests to service_role;
    grant select,insert on net.http_request_queue to service_role;grant select on net._http_response to service_role;
    create schema cron; create function cron.schedule(text,text,text) returns bigint language sql as $$ select 1::bigint $$;
    create function public.rls_auto_enable() returns event_trigger language plpgsql as $$ begin return; end $$;`);
  for (const file of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort()) {
    const migration = await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');
    // Only managed extension installation is substituted; all business SQL runs unchanged.
    await sql(migration.replace(/^create extension if not exists (pg_cron|pg_net).*;\r?$/gm,''));
  }
  await sql(`insert into auth.users select ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid from generate_series(1,100) i;
    insert into public.web_control(key,value) values('scheduler','{"enabled":true}') on conflict(key) do update set value=excluded.value;`);
  for (let i=1;i<=100;i++) await sql(`select public.web_bind('${uid(i)}','${config(i)}',repeat('0',61)||lpad('${i}',3,'0'),'${target(i)}','{"fingerprint":"fixture"}');`);

  await equal(`select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('web_accounts','web_reservations','web_control','web_request_limits') and c.relrowsecurity;`,'4');
  await equal(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'web_%' and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'));`,'0');
  await equal(`select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'web_%' and c.relkind='r' and (has_table_privilege('anon',c.oid,'select,insert,update,delete') or has_table_privilege('authenticated',c.oid,'select,insert,update,delete'));`,'0');
  await assert.rejects(sql('set role authenticated; select * from public.web_accounts;'),/permission denied/); assertions++;
  await assert.rejects(sql('set role anon; select public.web_nearby_status();'),/permission denied/); assertions++;
  const nearbyBurst=await burst('shared-public-device-batch',20,()=>sql('set role service_role; select public.web_nearby_status();'));
  assert.ok(nearbyBurst.every(r=>r.status==='fulfilled'));assertions++;
  await equal('select count(*) from net.http_request_queue;','35');
  await sql(`insert into net._http_response select id,200,jsonb_build_object('success',true,'obj',jsonb_build_object(
    'devaddress',params->>'devaddress','portstatur','0013','openId','SYNTHETIC_MUST_NOT_ESCAPE'))::text from net.http_request_queue;`);
  const shared=JSON.parse(await sql('set role service_role; select public.web_nearby_status();'));
  assert.equal(Object.values(shared.devices).filter(Boolean).length,35);assertions++;
  assert.ok(!JSON.stringify(shared).includes('SYNTHETIC_MUST_NOT_ESCAPE'));assertions++;
  await equal('select count(*) from net.http_request_queue;','35');
  await sql(`update public.web_nearby_reads set requested_at=now()-interval '31 seconds';`);
  await sql('set role service_role; select public.web_nearby_status();');
  await equal('select count(*) from net.http_request_queue;','70');
  await sql(`insert into net._http_response select id,200,'invalid JSON' from net.http_request_queue where id>35;`);
  const failedNearby=JSON.parse(await sql('set role service_role; select public.web_nearby_status();'));
  assert.equal(Object.values(failedNearby.devices).filter(Boolean).length,0);assertions++;
  await equal(`set role service_role; select public.web_rate_limit('${uid(99)}','read');`,'0');

  // Avoid straddling a legitimate fixed-window reset in this exact-quota assertion.
  const second=Number(await sql('select extract(second from clock_timestamp());'));
  if(second>50)await new Promise(resolve=>setTimeout(resolve,(61-second)*1000));
  const rates = await burst('shared-user-rate-limit',100,()=>sql(`select public.web_rate_limit('${uid(1)}','upstream');`));
  assert.equal(rates.filter(r=>r.status==='fulfilled'&&r.value==='0').length,10); assertions++;
  assert.ok(rates.every(r=>r.status==='fulfilled')); assertions++;
  await equal(`select public.web_rate_limit('${uid(1)}','safety');`,'0');
  await equal(`select public.web_rate_limit('${uid(2)}','upstream');`,'0');
  await sql(`update public.web_request_limits set window_start=now()-interval '2 minutes' where user_id='${uid(1)}';`);
  await equal(`select public.web_rate_limit('${uid(1)}','upstream');`,'0');

  const same = await burst('same-reservation-idempotency',32,()=>sql(reserve(1)));
  assert.ok(same.every(r=>r.status==='fulfilled'&&r.value===uid(10001))); assertions++;
  await equal('select count(*) from public.web_reservations;','1');
  await assert.rejects(sql(reserve(2,1)),/idempotency_conflict/); assertions++;
  await equal(`select public.web_cancel('${uid(2)}','${uid(10001)}');`,'f');
  await assert.rejects(sql(reserve(2,2,undefined,1)),/web_one_active_socket/); assertions++;

  const admission = await burst('different-users-same-time',32,i=>sql(reserve(i+2)));
  assert.equal(admission.filter(r=>r.status==='fulfilled').length,3); assertions++;
  assert.ok(admission.filter(r=>r.status==='rejected').every(r=>r.reason.message.includes('capacity_busy'))); assertions++;
  await equal('select count(*) from public.web_reservations;','4');
  await equal(reserve(1),uid(10001)); // retries still succeed when admission is full

  await sql(`update public.web_reservations set scheduled_at=now()-interval '1 minute',window_ends_at=now()+interval '9 minutes',due_at=now()-interval '1 minute';`);
  const claims = await burst('overlapping-schedulers',20,()=>sql('select id from public.web_claim_due(2);'));
  const claimed = claims.flatMap(r=>r.status==='fulfilled'&&r.value?r.value.split(/\r?\n/):[]);
  assert.equal(claimed.length,4);assert.equal(new Set(claimed).size,4); assertions+=2;
  const lease = await sql(`select lease_token from public.web_reservations where id='${uid(10001)}';`);
  const races = await burst('cancel-versus-consume',32,i=>sql(i%2===0?
    `select public.web_cancel('${uid(1)}','${uid(10001)}');`:
    `select public.web_consume('${uid(10001)}','${lease}','{"synthetic":true}');`));
  assert.equal(races.filter(r=>r.status==='fulfilled'&&r.value==='t').length,1); assertions++;
  const phase=await sql(`select phase from public.web_reservations where id='${uid(10001)}';`);
  assert.ok(['cancelled','submitting'].includes(phase)); assertions++;
  if(phase==='cancelled') await equal(`select public.web_finish('${uid(10001)}','${lease}','waiting','stale',null,now());`,'f');

  // Simulate a committed consume whose reply/worker was lost. Dump and restore the actual encrypted record.
  const recoveryId = claimed.find(id=>id!==uid(10001));
  const recoveryLease = await sql(`select lease_token from public.web_reservations where id='${recoveryId}';`);
  await equal(`select public.web_consume('${recoveryId}','${recoveryLease}','{"synthetic":true,"msgflag":"original-fixture"}');`,'t');
  const dump = await command(['exec',name,'pg_dump','-U','postgres','--no-owner','postgres']);
  await sql('create database restored;');
  await sql(dump,'restored');
  await assert.rejects(sql('set role authenticated; select * from public.web_accounts;','restored'),/permission denied/); assertions++;
  await equal(`select (start_consumed_at is not null)::text||':'||(public.web_decrypt(request_cipher)->>'msgflag') from public.web_reservations where id='${recoveryId}';`,'true:original-fixture','restored');
  await sql(`update public.web_reservations set lease_until=now()-interval '1 second',due_at=now()-interval '1 second' where id='${recoveryId}';`,'restored');
  await sql('select id from public.web_claim_due(2);','restored');
  await equal(`select public.web_consume(id,lease_token,'{}') from public.web_reservations where id='${recoveryId}';`,'f','restored');
  await equal(`select public.web_consume('${recoveryId}','${recoveryLease}','{}');`,'f');
  await sql('select public.web_dispatch_report(2,1,1);');
  await equal(`select value->>'failed' from public.web_control where key='dispatch';`,'1');
  await sql(`update public.web_control set value='{"enabled":false}' where key='scheduler'; select public.web_dispatch_report(0,0,0);`);
  await equal(`select value->>'enabled' from public.web_control where key='scheduler';`,'false');
  const metrics=JSON.parse(await sql('select public.web_operations();'));
  assert.ok(Number.isInteger(metrics.due)&&Number.isInteger(metrics.oldestDueSeconds)); assertions++;
  // Legacy backlog remains visible and late jobs cannot consume even with a valid lease.
  await sql(`update public.web_reservations set scheduled_at=now()-interval '20 minutes',window_ends_at=now()-interval '10 minutes',due_at=now()-interval '20 minutes',lease_until=null where start_consumed_at is null and phase='checking';`);
  const overdue=JSON.parse(await sql('select public.web_operations();'));
  assert.ok(overdue.oldestDueSeconds>=1200&&overdue.expiredUnsubmitted>=1); assertions++;
  await sql('select id from public.web_claim_due(2);');
  await equal(`select bool_or(public.web_consume(id,lease_token,'{}')) from public.web_reservations where start_consumed_at is null and window_ends_at<now();`,'f');
  console.log(JSON.stringify({result:'PASS',assertions,scope:'isolated PostgreSQL 16; no remote API, no charging; local process timings are not production capacity'}));
} finally {
  await command(['rm','-f',name]).catch(()=>{});
}
