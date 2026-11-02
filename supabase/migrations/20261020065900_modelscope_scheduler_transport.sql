-- ModelScope owns Authorization; use an explicitly configured app header there.
-- Existing endpoints keep their current Bearer transport when authHeader is absent.
create or replace function public.web_cron_trigger() returns bigint
language sql security invoker set search_path='' as $$
  select net.http_post(
    url:=(select value->>'url' from public.web_control where key='endpoint'),
    headers:=jsonb_build_object(
      'Content-Type','application/json',
      case when (select value->>'authHeader' from public.web_control where key='endpoint')='X-Neptune-Session'
        then 'X-Neptune-Session' else 'Authorization' end,
      'Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='neptune-web-cron')),
    body:='{}'::jsonb,timeout_milliseconds:=90000);
$$;
revoke all on function public.web_cron_trigger() from public, anon, authenticated;
grant execute on function public.web_cron_trigger() to service_role;
