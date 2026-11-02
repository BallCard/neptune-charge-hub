-- Public device telemetry only. No payment/account data or arbitrary destination.
create table public.web_nearby_reads (
  device text primary key check (device ~ '^[0-9]{8}$'),
  request_id bigint,
  requested_at timestamptz,
  observed_at timestamptz,
  result jsonb
);
alter table public.web_nearby_reads enable row level security;
revoke all on public.web_nearby_reads from public,anon,authenticated;
grant select,insert,update,delete on public.web_nearby_reads to service_role;
insert into public.web_nearby_reads(device) select unnest(array[
  '50359156','50359157','50359160','50359161','50359162','50359163','50359164','50359165','50359166','50359167',
  '50559147','50559148','50559149','50559150','51059127','60359116','60359117','60359118','60359119','60359120',
  '60359121','60359122','60359123','60359127','60359131','60459101','60459102','60459109','60459110','60459111',
  '60459119','60459120','60459129','60459130','60659111'
]);

create function public.web_nearby_status() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare d public.web_nearby_reads; response record; body jsonb; safe jsonb; found_response boolean;
begin
  -- One shared batch per 30 seconds across all visitors/instances. Never wait on network in SQL.
  if pg_try_advisory_xact_lock(hashtextextended('neptune-public-nearby',0)) then
    for d in select * from public.web_nearby_reads where request_id is not null loop
      select status_code,content into response from net._http_response where id=d.request_id;
      found_response := found;
      if found_response or d.requested_at<statement_timestamp()-interval '8 seconds' then
        safe := null;
        if found_response and response.status_code=200 and octet_length(response.content)<=1000000 then
          begin
            body := response.content::jsonb;
            if body->'success'='true'::jsonb and body->'obj'->>'devaddress'=d.device
              and jsonb_typeof(body->'obj'->'portstatur')='string'
              and length(body->'obj'->>'portstatur') between 1 and 99 then
              safe := jsonb_build_object('devaddress',d.device,'portstatur',body->'obj'->'portstatur',
                'longitude',body->'obj'->'longitude','latitude',body->'obj'->'latitude');
            end if;
          exception when invalid_text_representation then safe := null;
          end;
        end if;
        update public.web_nearby_reads set result=safe,observed_at=d.requested_at,request_id=null where device=d.device;
      end if;
    end loop;
    if (select coalesce(max(requested_at),'-infinity'::timestamptz)<statement_timestamp()-interval '30 seconds' from public.web_nearby_reads) then
      update public.web_nearby_reads set
        request_id=net.http_get(url:='https://www.szlzxn.cn/wxn/getDeviceInfo',
          params:=jsonb_build_object('areaId','6','devaddress',device),timeout_milliseconds:=6000),
        requested_at=statement_timestamp();
    end if;
  end if;
  return (select jsonb_build_object('updated_at',min(observed_at),'devices',jsonb_object_agg(device,result),
    'pending',bool_or(request_id is not null)) from public.web_nearby_reads);
end $$;
revoke all on function public.web_nearby_status() from public,anon,authenticated;
grant execute on function public.web_nearby_status() to service_role;
