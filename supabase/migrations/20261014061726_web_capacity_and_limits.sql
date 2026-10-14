-- Shared across serverless instances. Fixed windows, at most four rows per user.
create table public.web_request_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null check (bucket in ('read','upstream','reserve','safety')),
  window_start timestamptz not null,
  used integer not null check (used > 0),
  primary key (user_id,bucket)
);
alter table public.web_request_limits enable row level security;
revoke all on public.web_request_limits from public, anon, authenticated;
grant select,insert,update,delete on public.web_request_limits to service_role;

create function public.web_rate_limit(p_user uuid,p_bucket text) returns integer
language plpgsql security invoker set search_path='' as $$
declare cap integer; n integer; start_at timestamptz := date_trunc('minute',statement_timestamp());
begin
  cap := case p_bucket when 'read' then 60 when 'upstream' then 10 when 'reserve' then 10 when 'safety' then 20 else null end;
  if cap is null then raise exception 'invalid_bucket'; end if;
  insert into public.web_request_limits(user_id,bucket,window_start,used) values(p_user,p_bucket,start_at,1)
  on conflict(user_id,bucket) do update set
    used=case when web_request_limits.window_start<excluded.window_start then 1 else web_request_limits.used+1 end,
    window_start=greatest(web_request_limits.window_start,excluded.window_start)
  where web_request_limits.window_start<excluded.window_start or web_request_limits.used<cap
  returning used into n;
  if n is null then return greatest(1,ceil(extract(epoch from start_at+interval '1 minute'-statement_timestamp()))::integer); end if;
  return 0;
end $$;

-- Aggregate diagnostics only: no account identifiers, ciphertext or payment data.
create function public.web_operations() returns jsonb
language sql security invoker set search_path='' as $$
  select jsonb_build_object(
    'due',count(*) filter(where due_at<=now()),
    'oldestDueSeconds',coalesce(greatest(0,extract(epoch from now()-min(due_at) filter(where due_at<=now())))::integer,0),
    'expiredUnsubmitted',count(*) filter(where start_consumed_at is null and window_ends_at<now() and phase in ('scheduled','waiting','checking')),
    'uncertain',count(*) filter(where phase='uncertain'),
    'expiredLeases',count(*) filter(where lease_until<now()),
    'dispatch',(select value from public.web_control where key='dispatch'))
  from public.web_reservations where due_at is not null or phase='uncertain';
$$;

create function public.web_dispatch_report(p_claimed integer,p_processed integer,p_failed integer) returns void
language plpgsql security invoker set search_path='' as $$
declare age_seconds integer;
begin
  if p_claimed<0 or p_claimed>2 or p_processed<0 or p_failed<0 or p_processed+p_failed<>p_claimed then raise exception 'invalid_report'; end if;
  select coalesce(greatest(0,extract(epoch from now()-min(due_at)))::integer,0) into age_seconds
    from public.web_reservations where due_at<=now();
  insert into public.web_control(key,value) values('dispatch',jsonb_build_object('completedAt',now(),'claimed',p_claimed,'processed',p_processed,'failed',p_failed,'oldestDueSeconds',age_seconds))
    on conflict(key) do update set value=excluded.value,updated_at=now();
  -- Do not overwrite a concurrent operator's enabled=false with a stale API read.
  if p_failed=0 then update public.web_control set value=jsonb_set(value,'{lastTick}',to_jsonb(now())),updated_at=now() where key='scheduler'; end if;
end $$;

create or replace function public.web_reserve(p_user uuid,p_id uuid,p_scheduled timestamptz,p_target jsonb,p_scheme jsonb,p_cap integer,p_snapshot jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare a public.web_accounts; existing public.web_reservations; guard timestamptz;
begin
  -- Serialize admission across users so a burst cannot overbook the execution window.
  perform pg_advisory_xact_lock(hashtextextended('neptune-web-capacity',0));
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  select * into existing from public.web_reservations where id=p_id;
  if found then
    if existing.user_id<>p_user or existing.scheduled_at<>p_scheduled or existing.device<>p_target->>'device' or existing.port<>p_target->>'port' or existing.scheme_id is distinct from p_scheme->>'id' or existing.max_prepay_cents is distinct from p_cap then raise exception 'idempotency_conflict'; end if;
    return existing.id;
  end if;
  select * into a from public.web_accounts where user_id=p_user for update;
  if a.config_cipher is null or a.account_hash is null then raise exception 'not_bound'; end if;
  if public.web_decrypt(a.config_cipher) is distinct from p_snapshot->'config' then raise exception 'account_changed'; end if;
  if (a.quote->>'fingerprint') is distinct from (p_snapshot->>'fingerprint') then raise exception 'quote_changed'; end if;
  if p_scheduled<now()+interval '1 minute' or p_scheduled>now()+interval '48 hours' then raise exception 'invalid_time'; end if;
  select (value->>'until')::timestamptz into guard from public.web_control where key='legacy_guard';
  if guard is not null and p_scheduled<guard then raise exception 'legacy_plan'; end if;
  -- Conservative admission, not a timing SLA. Reserve room for follow-up checks/recovery.
  if (select count(*) from public.web_reservations where
      scheduled_at between p_scheduled-interval '10 minutes' and p_scheduled+interval '10 minutes'
      and phase in ('scheduled','waiting','checking','submitting','pending','uncertain'))>=4 then
    raise exception 'capacity_busy';
  end if;
  insert into public.web_reservations(id,user_id,account_hash,device,port,scheme_id,scheme_title,max_minutes,max_prepay_cents,scheduled_at,window_ends_at,due_at,snapshot_cipher)
    values(p_id,p_user,a.account_hash,p_target->>'device',p_target->>'port',p_scheme->>'id',p_scheme->>'title',(p_scheme->>'maxMinutes')::integer,p_cap,p_scheduled,p_scheduled+interval '10 minutes',p_scheduled,public.web_encrypt(p_snapshot));
  return p_id;
end $$;

revoke all on function public.web_rate_limit(uuid,text),public.web_operations(),public.web_dispatch_report(integer,integer,integer) from public,anon,authenticated;
grant execute on function public.web_rate_limit(uuid,text),public.web_operations(),public.web_dispatch_report(integer,integer,integer) to service_role;
