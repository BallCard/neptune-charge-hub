-- Cancellation and submission contend on the same row. Clearing the lease also
-- prevents a worker's stale read/finish from reviving a cancelled reservation.
create or replace function public.web_cancel(p_user uuid,p_id uuid) returns boolean
language sql security invoker set search_path='' as $$
  with changed as (
    update public.web_reservations
    set phase='cancelled',due_at=null,lease_token=null,lease_until=null,
        result='已取消，未发起开电；可以更换插座并重新预约。',updated_at=now()
    where id=p_id and user_id=p_user
      and phase in ('scheduled','waiting','checking') and start_consumed_at is null
    returning id
  ) select exists(select 1 from changed);
$$;
