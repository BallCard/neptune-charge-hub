-- Supabase's automatic RLS event trigger is an internal DDL helper.
-- It must not be a callable client RPC.
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
