-- Run once in the dedicated project's SQL editor. No private user data belongs here.
create table public.charge_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_hash text not null unique,
  account_cipher text not null,
  preferences jsonb not null default '{"defaultTime":"06:00","weekdays":[1,2,3,4,5],"maxPrepayCents":200}',
  created_at timestamptz not null default now()
);
create table public.charge_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 40),
  device text not null check (device ~ '^[0-9]{8}$'),
  port text not null check (port ~ '^[0-9]{2}$'),
  prices jsonb not null,
  unique(user_id, device, port)
);
create table public.charge_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null references public.charge_targets(id),
  account_hash text not null,
  device text not null,
  port text not null,
  account_cipher text not null,
  max_prepay_cents integer not null check (max_prepay_cents between 1 and 200),
  scheduled_at timestamptz not null,
  phase text not null default 'queued' check (phase in ('queued','scheduled','waiting','checking','submitting','pending','confirmed','already-charging','cancelled','failed','expired','uncertain','rejected')),
  result text,
  workflow_id text,
  watchdog_id text,
  transaction_cipher text,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  finished_at timestamptz,
  idempotency_key uuid not null,
  unique(user_id, idempotency_key)
);
create unique index one_active_booking_per_account on public.charge_reservations(account_hash)
  where phase in ('queued','scheduled','waiting','checking','submitting','pending','uncertain');
create unique index one_active_booking_per_user on public.charge_reservations(user_id)
  where phase in ('queued','scheduled','waiting','checking','submitting','pending','uncertain');
create unique index one_active_booking_per_socket on public.charge_reservations(device,port)
  where phase in ('queued','scheduled','waiting','checking','submitting','pending','uncertain');
create index reservations_by_owner on public.charge_reservations(user_id,created_at desc);
create index targets_by_owner on public.charge_targets(user_id);
alter table public.charge_accounts enable row level security;
alter table public.charge_targets enable row level security;
alter table public.charge_reservations enable row level security;
-- Only the authenticated server can read/write sensitive tables. All browser access uses checked API routes.
revoke all on public.charge_accounts, public.charge_targets, public.charge_reservations from anon, authenticated;
grant all on public.charge_accounts, public.charge_targets, public.charge_reservations to service_role;
create table public.charge_diagnostics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  phase text not null default 'queued',
  workflow_id text,
  started_at timestamptz,
  finished_at timestamptz,
  platform_reachable boolean,
  created_at timestamptz not null default now()
);
create index diagnostics_by_owner on public.charge_diagnostics(user_id);
alter table public.charge_diagnostics enable row level security;
revoke all on public.charge_diagnostics from anon, authenticated;
grant all on public.charge_diagnostics to service_role;
