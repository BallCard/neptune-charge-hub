-- The authenticated Edge API is the only data entry point.
-- Never store a payment URL, openId, raw request or response in clear text.
create table public.web_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_hash text unique check (account_hash ~ '^[a-f0-9]{64}$'),
  config_cipher bytea check (octet_length(config_cipher) >= 64),
  cipher_version smallint not null default 1 check (cipher_version = 1),
  target jsonb,
  quote jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((account_hash is null) = (config_cipher is null))
);
create table public.web_reservations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  account_hash text not null check (account_hash ~ '^[a-f0-9]{64}$'),
  device text not null check (device ~ '^[0-9]{8}$'),
  port text not null check (port ~ '^(0[1-9]|[1-9][0-9])$'),
  scheme_id text not null,
  scheme_title text not null,
  max_minutes integer not null check (max_minutes between 1 and 1440),
  max_prepay_cents integer not null check (max_prepay_cents between 1 and 1000),
  scheduled_at timestamptz not null,
  window_ends_at timestamptz not null,
  due_at timestamptz,
  phase text not null default 'scheduled' check (phase in ('scheduled','waiting','checking','submitting','pending','confirmed','already-charging','cancelled','failed','uncertain','reviewed','rejected','missed')),
  snapshot_cipher bytea not null check (octet_length(snapshot_cipher) >= 64),
  request_cipher bytea,
  start_consumed_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  result text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (window_ends_at = scheduled_at + interval '10 minutes'),
  check (start_consumed_at is null or phase not in ('scheduled','waiting','checking','cancelled'))
);
-- A single platform account cannot execute concurrent plans through different website users.
create unique index web_one_active_account on public.web_reservations (account_hash)
  where phase in ('scheduled','waiting','checking','submitting','pending','uncertain');
create index web_user_history on public.web_reservations (user_id, created_at desc);
create index web_due_jobs on public.web_reservations (due_at)
  where phase in ('scheduled','waiting','checking','submitting','pending','confirmed','uncertain');
alter table public.web_accounts enable row level security;
alter table public.web_reservations enable row level security;
revoke all on public.web_accounts, public.web_reservations from public, anon, authenticated;
grant select, insert, update, delete on public.web_accounts, public.web_reservations to service_role;
-- No public user policies: every API operation must validate the user JWT and pin user_id server-side.

create table public.web_control (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
alter table public.web_control enable row level security;
revoke all on public.web_control from public, anon, authenticated;
grant select, insert, update on public.web_control to service_role;

-- Both keys are generated in the database and never returned to a browser or management logs.
do $$ begin
  if not exists (select 1 from vault.secrets where name='neptune-web-encryption') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'neptune-web-encryption');
  end if;
  if not exists (select 1 from vault.secrets where name='neptune-web-cron') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'neptune-web-cron');
  end if;
end $$;
grant usage on schema vault to service_role;
grant select on vault.decrypted_secrets to service_role;

create function public.web_encrypt(p_value jsonb) returns bytea language sql security invoker set search_path='' as $$
  select extensions.pgp_sym_encrypt(p_value::text, (select decrypted_secret from vault.decrypted_secrets where name='neptune-web-encryption'), 'cipher-algo=aes256,compress-algo=0');
$$;
create function public.web_decrypt(p_cipher bytea) returns jsonb language sql security invoker set search_path='' as $$
  select case when p_cipher is null then null else extensions.pgp_sym_decrypt(p_cipher, (select decrypted_secret from vault.decrypted_secrets where name='neptune-web-encryption'))::jsonb end;
$$;
create function public.web_cron_authorized(p_secret text) returns boolean language sql security invoker set search_path='' as $$
  select p_secret = (select decrypted_secret from vault.decrypted_secrets where name='neptune-web-cron');
$$;
create function public.web_profile(p_user uuid) returns jsonb language sql security invoker set search_path='' as $$
  select jsonb_build_object('config',public.web_decrypt(a.config_cipher),'accountHash',a.account_hash,'target',a.target,'quote',a.quote)
  from public.web_accounts a where a.user_id=p_user;
$$;
create function public.web_bind(p_user uuid,p_config jsonb,p_hash text,p_target jsonb,p_quote jsonb) returns void language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  if exists (select 1 from public.web_reservations where user_id=p_user and phase in ('scheduled','waiting','checking','submitting','pending','uncertain')) then
    raise exception 'active_plan';
  end if;
  insert into public.web_accounts(user_id,account_hash,config_cipher,target,quote)
    values(p_user,p_hash,public.web_encrypt(p_config),p_target,p_quote)
  on conflict(user_id) do update set account_hash=excluded.account_hash,config_cipher=excluded.config_cipher,target=excluded.target,quote=excluded.quote,updated_at=now();
end $$;
create function public.web_target(p_user uuid,p_target jsonb,p_quote jsonb) returns void language sql security invoker set search_path='' as $$
  insert into public.web_accounts(user_id,target,quote) values(p_user,p_target,p_quote)
  on conflict(user_id) do update set target=excluded.target,quote=excluded.quote,updated_at=now();
$$;
create function public.web_reserve(p_user uuid,p_id uuid,p_scheduled timestamptz,p_target jsonb,p_scheme jsonb,p_cap integer,p_snapshot jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
declare a public.web_accounts; existing public.web_reservations; guard timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  select * into existing from public.web_reservations where id=p_id;
  if found then
    if existing.user_id<>p_user or existing.scheduled_at<>p_scheduled or existing.device<>p_target->>'device' or existing.port<>p_target->>'port' then raise exception 'idempotency_conflict'; end if;
    return existing.id;
  end if;
  select * into a from public.web_accounts where user_id=p_user for update;
  if a.config_cipher is null or a.account_hash is null then raise exception 'not_bound'; end if;
  if public.web_decrypt(a.config_cipher)<>p_snapshot->'config' then raise exception 'account_changed'; end if;
  if a.quote->>'fingerprint'<>p_snapshot->>'fingerprint' then raise exception 'quote_changed'; end if;
  if p_scheduled<now()+interval '1 minute' or p_scheduled>now()+interval '48 hours' then raise exception 'invalid_time'; end if;
  select (value->>'until')::timestamptz into guard from public.web_control where key='legacy_guard';
  if guard is not null and p_scheduled<guard then raise exception 'legacy_plan'; end if;
  insert into public.web_reservations(id,user_id,account_hash,device,port,scheme_id,scheme_title,max_minutes,max_prepay_cents,scheduled_at,window_ends_at,due_at,snapshot_cipher)
    values(p_id,p_user,a.account_hash,p_target->>'device',p_target->>'port',p_scheme->>'id',p_scheme->>'title',(p_scheme->>'maxMinutes')::integer,p_cap,p_scheduled,p_scheduled+interval '10 minutes',p_scheduled,public.web_encrypt(p_snapshot));
  return p_id;
end $$;
create function public.web_cancel(p_user uuid,p_id uuid) returns boolean language sql security invoker set search_path='' as $$
  with changed as (update public.web_reservations set phase='cancelled',due_at=null,result='已取消，未发起开电。',updated_at=now()
    where id=p_id and user_id=p_user and phase='scheduled' and start_consumed_at is null and scheduled_at>now()+interval '30 seconds' returning id)
  select exists(select 1 from changed);
$$;
create function public.web_claim_due(p_limit integer default 2) returns setof public.web_reservations language sql security invoker set search_path='' as $$
  with candidates as (select id from public.web_reservations where due_at<=now()
    and phase in ('scheduled','waiting','checking','submitting','pending','confirmed','uncertain')
    and (lease_until is null or lease_until<now()) order by due_at for update skip locked limit least(greatest(p_limit,1),2))
  update public.web_reservations r set lease_token=gen_random_uuid(),lease_until=now()+interval '90 seconds',updated_at=now(),
    phase=case when r.start_consumed_at is null then 'checking' else r.phase end
  from candidates c where r.id=c.id returning r.*;
$$;
create function public.web_consume(p_id uuid,p_lease uuid,p_prepared jsonb) returns boolean language sql security invoker set search_path='' as $$
  with changed as (update public.web_reservations set phase='submitting',start_consumed_at=now(),request_cipher=public.web_encrypt(p_prepared),due_at=now()+interval '1 minute',updated_at=now()
    where id=p_id and lease_token=p_lease and lease_until>now() and phase='checking' and start_consumed_at is null and now()<=window_ends_at returning id)
  select exists(select 1 from changed);
$$;
create function public.web_finish(p_id uuid,p_lease uuid,p_phase text,p_result text,p_prepared jsonb,p_due timestamptz) returns boolean language sql security invoker set search_path='' as $$
  with changed as (update public.web_reservations set phase=p_phase,result=left(p_result,600),
    request_cipher=case when p_prepared is null then request_cipher else public.web_encrypt(p_prepared) end,
    due_at=p_due,lease_until=null,lease_token=null,updated_at=now()
    where id=p_id and lease_token=p_lease and lease_until>now() returning id)
  select exists(select 1 from changed);
$$;
create function public.web_review(p_user uuid,p_id uuid) returns boolean language sql security invoker set search_path='' as $$
  with changed as (update public.web_reservations set phase='reviewed',result='本人已核对，旧请求不会重发。',due_at=null,updated_at=now()
    where id=p_id and user_id=p_user and phase='uncertain' and (lease_until is null or lease_until<now()) returning id)
  select exists(select 1 from changed);
$$;
do $$ declare f record; begin
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in
    ('web_encrypt','web_decrypt','web_cron_authorized','web_profile','web_bind','web_target','web_reserve','web_cancel','web_claim_due','web_consume','web_finish','web_review')
  loop
    execute format('revoke all on function %s from public, anon, authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
