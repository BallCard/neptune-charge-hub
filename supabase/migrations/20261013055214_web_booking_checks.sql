create or replace function public.web_reserve(p_user uuid,p_id uuid,p_scheduled timestamptz,p_target jsonb,p_scheme jsonb,p_cap integer,p_snapshot jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
declare a public.web_accounts; existing public.web_reservations; guard timestamptz;
begin
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
  insert into public.web_reservations(id,user_id,account_hash,device,port,scheme_id,scheme_title,max_minutes,max_prepay_cents,scheduled_at,window_ends_at,due_at,snapshot_cipher)
    values(p_id,p_user,a.account_hash,p_target->>'device',p_target->>'port',p_scheme->>'id',p_scheme->>'title',(p_scheme->>'maxMinutes')::integer,p_cap,p_scheduled,p_scheduled+interval '10 minutes',p_scheduled,public.web_encrypt(p_snapshot));
  return p_id;
end $$;

create unique index web_one_active_socket on public.web_reservations(device,port) where phase in ('scheduled','waiting','checking','submitting','pending','uncertain');
