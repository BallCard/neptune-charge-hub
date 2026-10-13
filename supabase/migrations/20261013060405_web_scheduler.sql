create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
grant usage on schema auth to service_role;
grant select (id,user_id) on auth.sessions to service_role;
create function public.web_session_active(p_user uuid,p_session uuid) returns boolean language sql security invoker set search_path='' as $$
  select exists(select 1 from auth.sessions where id=p_session and user_id=p_user);
$$;
revoke all on function public.web_session_active(uuid,uuid) from public, anon, authenticated;
grant execute on function public.web_session_active(uuid,uuid) to service_role;
create function public.web_cron_trigger() returns bigint language sql security invoker set search_path='' as $$
  select net.http_post(
    url:=(select value->>'url' from public.web_control where key='endpoint'),
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='neptune-web-cron')),
    body:='{}'::jsonb,timeout_milliseconds:=90000);
$$;
revoke all on function public.web_cron_trigger() from public, anon, authenticated;
grant execute on function public.web_cron_trigger() to service_role;
insert into public.web_control(key,value) values('scheduler','{"enabled":false}') on conflict(key) do nothing;
-- The deployment helper seeds the endpoint and schedules the job only after isolated validation.
