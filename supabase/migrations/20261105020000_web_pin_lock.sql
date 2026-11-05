-- Optional second factor: a browser that already stores payment authorization must also
-- confirm a 6-digit reservation PIN before a new plan is registered. The PIN is stored only
-- as a per-user bcrypt hash and is never returned to the client.
alter table public.web_accounts
  add column pin_hash text,
  add column pin_set_at timestamptz;
alter table public.web_accounts
  add constraint web_accounts_pin_hash_check check (pin_hash is null or pin_hash ~ '^[$]2[aby][$][0-9]{2}[$].{53}$');

create or replace function public.web_profile(p_user uuid) returns jsonb language sql security invoker set search_path='' as $$
  select jsonb_build_object('config',public.web_decrypt(a.config_cipher),'accountHash',a.account_hash,
    'target',a.target,'quote',a.quote,'pinSet',a.pin_hash is not null)
  from public.web_accounts a where a.user_id=p_user;
$$;

-- Set or change the PIN. Changing an existing PIN requires the current one.
create function public.web_set_pin(p_user uuid,p_pin text,p_current text default null) returns void
language plpgsql security invoker set search_path='' as $$
declare a public.web_accounts;
begin
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then raise exception 'invalid_pin'; end if;
  if p_current is not null and p_current !~ '^[0-9]{6}$' then raise exception 'pin_mismatch'; end if;
  select * into a from public.web_accounts where user_id=p_user for update;
  if not found or a.config_cipher is null or a.account_hash is null then raise exception 'not_bound'; end if;
  if a.pin_hash is not null and (p_current is null or extensions.crypt(p_current,a.pin_hash)<>a.pin_hash) then raise exception 'pin_mismatch'; end if;
  update public.web_accounts set pin_hash=extensions.crypt(p_pin,extensions.gen_salt('bf')),pin_set_at=now(),updated_at=now()
    where user_id=p_user;
end $$;

-- Remove the PIN; the current PIN is required so an open tab cannot silently drop the factor.
create function public.web_clear_pin(p_user uuid,p_pin text) returns void
language plpgsql security invoker set search_path='' as $$
declare a public.web_accounts;
begin
  select * into a from public.web_accounts where user_id=p_user for update;
  if not found then raise exception 'not_bound'; end if;
  if a.pin_hash is null then return; end if;
  if p_pin is null or p_pin !~ '^[0-9]{6}$' or extensions.crypt(p_pin,a.pin_hash)<>a.pin_hash then raise exception 'pin_mismatch'; end if;
  update public.web_accounts set pin_hash=null,pin_set_at=null,updated_at=now() where user_id=p_user;
end $$;

-- Read-only check so the API can reject a wrong PIN before any platform read or write.
create function public.web_verify_pin(p_user uuid,p_pin text) returns boolean
language sql security invoker set search_path='' as $$
  select exists(select 1 from public.web_accounts a where a.user_id=p_user
    and (a.pin_hash is null or (p_pin is not null and p_pin ~ '^[0-9]{6}$' and extensions.crypt(p_pin,a.pin_hash)=a.pin_hash)));
$$;

-- Replace the seven-argument signature so PostgREST cannot resolve an overload that skips the PIN check.
drop function if exists public.web_reserve(uuid,uuid,timestamptz,jsonb,jsonb,integer,jsonb);
create function public.web_reserve(p_user uuid,p_id uuid,p_scheduled timestamptz,p_target jsonb,p_scheme jsonb,p_cap integer,p_snapshot jsonb,p_pin text default null) returns uuid
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
  -- Same check the API performs; kept here so a direct RPC cannot bypass it.
  if a.pin_hash is not null and (p_pin is null or p_pin !~ '^[0-9]{6}$' or extensions.crypt(p_pin,a.pin_hash)<>a.pin_hash) then
    raise exception 'pin_required';
  end if;
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

-- A separate bucket keeps PIN attempts from consuming reservation or upstream budgets.
alter table public.web_request_limits drop constraint if exists web_request_limits_bucket_check;
alter table public.web_request_limits add constraint web_request_limits_bucket_check check (bucket in ('read','upstream','reserve','safety','pin'));

create or replace function public.web_rate_limit(p_user uuid,p_bucket text) returns integer
language plpgsql security invoker set search_path='' as $$
declare cap integer; n integer; start_at timestamptz := date_trunc('minute',statement_timestamp());
begin
  cap := case p_bucket when 'read' then 60 when 'upstream' then 10 when 'reserve' then 10 when 'safety' then 20 when 'pin' then 8 else null end;
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

revoke all on function public.web_set_pin(uuid,text,text),public.web_clear_pin(uuid,text),public.web_verify_pin(uuid,text),public.web_reserve(uuid,uuid,timestamptz,jsonb,jsonb,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.web_set_pin(uuid,text,text),public.web_clear_pin(uuid,text),public.web_verify_pin(uuid,text),public.web_reserve(uuid,uuid,timestamptz,jsonb,jsonb,integer,jsonb,text) to service_role;