-- Supabase Auth supplies user.is_anonymous; client-editable user_metadata is ignored.
-- Keep existing email identities usable while new users use browser identities only.
create or replace function public.web_before_user_created(event jsonb)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select case when event->'user'->'is_anonymous' = 'true'::jsonb
    then '{}'::jsonb
    else jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', '晨充已改为免注册使用，请直接打开网页。旧账号仍可恢复。'
    )) end;
$$;
revoke all on function public.web_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.web_before_user_created(jsonb) to supabase_auth_admin;
