-- WalletWise relational core. Auth0 subjects are opaque text, never UUIDs.
create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.auth0_subject()
returns text language sql stable security definer
set search_path = ''
as $$
  select case when auth.jwt() ->> 'role' = 'authenticated'
    and nullif(auth.jwt() ->> 'sub', '') is not null
    then auth.jwt() ->> 'sub' else null end
$$;
revoke all on function private.auth0_subject() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.auth0_subject() to authenticated;

create table public.profiles (
  auth0_sub text primary key check (length(auth0_sub) between 1 and 512),
  email text check (email is null or length(email) <= 254),
  email_verified boolean not null default false,
  full_name text check (full_name is null or length(full_name) between 1 and 60),
  preferred_currency text not null default 'ILS' check (preferred_currency in ('ILS','USD','JOD')),
  savings_enabled boolean,
  currency_notifications boolean not null default false,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  auth0_sub text not null references public.profiles(auth0_sub) on delete cascade,
  currency text not null check(currency in ('ILS','USD','JOD')),
  minor_unit_scale smallint generated always as (case when currency='JOD' then 1000 else 100 end) stored,
  available_minor bigint not null default 0 check(available_minor between 0 and 9007199254740991),
  savings_minor bigint not null default 0 check(savings_minor between 0 and 9007199254740991),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(auth0_sub,currency), unique(id,auth0_sub,currency)
);
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  auth0_sub text not null references public.profiles(auth0_sub) on delete cascade,
  request_id uuid not null,
  request_fingerprint text not null,
  kind text not null check(kind in ('purchase','refund','conversion','opening','adjustment')),
  description text not null check(length(description) between 1 and 160),
  category text not null default 'Other',
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique(auth0_sub,request_id), unique(id,auth0_sub)
);
create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null,
  auth0_sub text not null,
  currency text not null check(currency in ('ILS','USD','JOD')),
  account text not null check(account in ('available','savings','external')),
  amount_minor bigint not null check(amount_minor <> 0 and amount_minor between -9007199254740991 and 9007199254740991),
  created_at timestamptz not null default now(),
  foreign key(transaction_id,auth0_sub) references public.transactions(id,auth0_sub) on delete cascade,
  foreign key(auth0_sub,currency) references public.wallets(auth0_sub,currency)
);
create table public.savings_rules (
  auth0_sub text not null references public.profiles(auth0_sub) on delete cascade,
  currency text not null check(currency in ('ILS','USD','JOD')),
  enabled boolean not null default false,
  increment_minor bigint not null check(increment_minor > 0),
  cap_minor bigint not null check(cap_minor >= 0),
  updated_at timestamptz not null default now(),
  primary key(auth0_sub,currency),
  foreign key(auth0_sub,currency) references public.wallets(auth0_sub,currency)
);
create table public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  auth0_sub text not null references public.profiles(auth0_sub) on delete cascade,
  currency text not null check(currency in ('ILS','USD','JOD')),
  name text not null check(length(name) between 1 and 60),
  target_minor bigint not null check(target_minor > 0),
  target_date date,
  created_at timestamptz not null default now(),
  unique(id,auth0_sub,currency),
  foreign key(auth0_sub,currency) references public.wallets(auth0_sub,currency)
);
create table public.savings_allocations (
  id uuid primary key default gen_random_uuid(),
  auth0_sub text not null,
  goal_id uuid not null,
  currency text not null check(currency in ('ILS','USD','JOD')),
  transaction_id uuid,
  amount_minor bigint not null check(amount_minor > 0),
  created_at timestamptz not null default now(),
  foreign key(goal_id,auth0_sub,currency) references public.savings_goals(id,auth0_sub,currency) on delete cascade,
  foreign key(transaction_id,auth0_sub) references public.transactions(id,auth0_sub)
);
create table public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  from_currency text not null check(from_currency in ('ILS','USD','JOD')),
  to_currency text not null check(to_currency in ('ILS','USD','JOD')),
  bid_units bigint not null check(bid_units > 0),
  ask_units bigint not null check(ask_units >= bid_units),
  rate_scale bigint not null default 1000000 check(rate_scale = 1000000),
  source text not null,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(from_currency,to_currency,observed_at)
);
create table public.currency_alerts (
  id uuid primary key default gen_random_uuid(),
  auth0_sub text not null references public.profiles(auth0_sub) on delete cascade,
  from_currency text not null check(from_currency in ('ILS','USD','JOD')),
  to_currency text not null check(to_currency in ('ILS','USD','JOD')),
  direction text not null check(direction in ('increase','decrease')),
  threshold numeric(18,6) not null check(threshold > 0),
  enabled boolean not null default true,
  reference_units bigint not null check(reference_units > 0),
  watched_minor bigint check(watched_minor is null or watched_minor > 0),
  created_at timestamptz not null default now(),
  check(from_currency <> to_currency)
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  auth0_sub text not null references public.profiles(auth0_sub) on delete cascade,
  title text not null check(length(title) between 1 and 160),
  body text not null check(length(body) <= 2000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.ai_reports (
  id uuid primary key default gen_random_uuid(),
  auth0_sub text not null references public.profiles(auth0_sub) on delete cascade,
  frequency text not null check(frequency in ('weekly','monthly')),
  report jsonb not null,
  created_at timestamptz not null default now()
);

-- Remove broad default grants and expose only RLS-filtered reads to clients.
revoke all on public.profiles, public.wallets, public.transactions, public.ledger_entries, public.savings_rules, public.savings_goals, public.savings_allocations, public.exchange_rates, public.currency_alerts, public.notifications, public.ai_reports from public, anon, authenticated, service_role;
-- Opt in future objects explicitly, including functions (PUBLIC otherwise inherits EXECUTE).
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated, service_role;
do $$
declare t text;
begin
  foreach t in array array['profiles','wallets','transactions','ledger_entries','savings_rules','savings_goals','savings_allocations','exchange_rates','currency_alerts','notifications','ai_reports'] loop
    execute format('alter table public.%I enable row level security',t);
    if t <> 'exchange_rates' then
      execute format('create policy own_rows on public.%I for select to authenticated using (auth0_sub = (select private.auth0_subject()))',t);
    end if;
  end loop;
end $$;
create policy read_exchange_rates on public.exchange_rates for select to authenticated using (true);
grant select on public.profiles, public.wallets, public.transactions, public.ledger_entries,
  public.savings_rules, public.savings_goals, public.savings_allocations,
  public.currency_alerts, public.notifications, public.ai_reports to authenticated;
grant select on public.exchange_rates to authenticated;
grant select on public.profiles, public.wallets, public.transactions, public.ledger_entries, public.savings_rules, public.savings_goals, public.savings_allocations, public.exchange_rates, public.currency_alerts, public.notifications, public.ai_reports to service_role;

create or replace function public.walletwise_initialize_user(p_auth0_sub text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.profiles;
begin
  if p_auth0_sub is null or length(p_auth0_sub) not between 1 and 512 then raise exception 'Invalid Auth0 subject'; end if;
  insert into public.profiles(auth0_sub) values(p_auth0_sub) on conflict(auth0_sub) do nothing;
  insert into public.wallets(auth0_sub,currency) values
    (p_auth0_sub,'ILS'),(p_auth0_sub,'USD'),(p_auth0_sub,'JOD') on conflict(auth0_sub,currency) do nothing;
  insert into public.savings_rules(auth0_sub,currency,increment_minor,cap_minor) values
    (p_auth0_sub,'ILS',500,2000),(p_auth0_sub,'USD',100,500),(p_auth0_sub,'JOD',1000,5000)
    on conflict(auth0_sub,currency) do nothing;
  select * into p from public.profiles where auth0_sub=p_auth0_sub;
  return to_jsonb(p);
end $$;

create or replace function public.walletwise_complete_onboarding(
  p_auth0_sub text,p_full_name text,p_email text,p_email_verified boolean,
  p_preferred_currency text,p_savings_enabled boolean,p_currency_notifications boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.profiles;
begin
  if p_auth0_sub is null or length(p_auth0_sub) not between 1 and 512 then raise exception 'Invalid Auth0 subject'; end if;
  if p_full_name is null or length(btrim(p_full_name)) not between 1 and 60 then raise exception 'Invalid full name'; end if;
  if p_email is not null and length(p_email)>254 then raise exception 'Invalid email'; end if;
  if p_preferred_currency not in ('ILS','USD','JOD') then raise exception 'Invalid currency'; end if;
  perform public.walletwise_initialize_user(p_auth0_sub);
  select * into p from public.profiles where auth0_sub=p_auth0_sub for update;
  if p.onboarding_completed_at is not null then return to_jsonb(p); end if;
  update public.profiles set full_name=btrim(p_full_name), email=p_email,
    email_verified=coalesce(p_email_verified,false), preferred_currency=p_preferred_currency,
    savings_enabled=p_savings_enabled,currency_notifications=coalesce(p_currency_notifications,false),
    onboarding_completed_at=coalesce(onboarding_completed_at,now()),updated_at=now()
    where auth0_sub=p_auth0_sub;
  update public.savings_rules set enabled=p_savings_enabled,updated_at=now() where auth0_sub=p_auth0_sub;
  select * into p from public.profiles where auth0_sub=p_auth0_sub;
  return to_jsonb(p);
end $$;

create or replace function public.walletwise_apply_transaction(
  p_auth0_sub text,p_request_id uuid,p_request_fingerprint text,p_kind text,
  p_description text,p_category text,p_entries jsonb,p_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare tx public.transactions; cur text; acct text; entry jsonb;
begin
  if p_auth0_sub is null or length(p_auth0_sub) not between 1 and 512 then raise exception 'Invalid Auth0 subject'; end if;
  if p_kind not in ('purchase','refund','conversion','opening','adjustment') then raise exception 'Invalid transaction kind'; end if;
  if p_request_id is null or p_request_fingerprint is null or p_entries is null or jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries)<2 or jsonb_array_length(p_entries)>24 then raise exception 'Invalid transaction'; end if;
  perform public.walletwise_initialize_user(p_auth0_sub);
  perform 1 from public.wallets where auth0_sub=p_auth0_sub order by currency for update;
  select * into tx from public.transactions where auth0_sub=p_auth0_sub and request_id=p_request_id;
  if found then
    if tx.request_fingerprint<>p_request_fingerprint then raise exception 'Idempotency key reused with different request'; end if;
    return to_jsonb(tx);
  end if;
  if p_kind='refund' and not exists (
    select 1 from public.transactions where id=(p_metadata->>'originalId')::uuid
      and auth0_sub=p_auth0_sub and kind='purchase'
  ) then raise exception 'Purchase not found'; end if;
  if p_kind='refund' and exists (
    select currency,account,sum(amount_minor) from (
      select currency,account,amount_minor from public.ledger_entries
        where transaction_id=(p_metadata->>'originalId')::uuid and auth0_sub=p_auth0_sub
      union all
      select e->>'currency',e->>'account',(e->>'amount_minor')::bigint
        from jsonb_array_elements(p_entries) e
    ) reversals group by currency,account having sum(amount_minor)<>0
  ) then raise exception 'Refund must reverse the original purchase'; end if;
  if exists (select 1 from jsonb_array_elements(p_entries) e where
    coalesce(e->>'currency','') not in ('ILS','USD','JOD') or coalesce(e->>'account','') not in ('available','savings','external')
    or coalesce(e->>'amount_minor','') !~ '^-?[0-9]+$' or coalesce((e->>'amount_minor')::bigint,0)=0) then raise exception 'Invalid ledger entry'; end if;
  if exists(select 1 from jsonb_array_elements(p_entries) e group by e->>'currency'
    having sum((e->>'amount_minor')::bigint)<>0) then raise exception 'Unbalanced ledger'; end if;
  for cur in select distinct e->>'currency' from jsonb_array_elements(p_entries) e loop
    if (select available_minor + coalesce(sum((x->>'amount_minor')::bigint) filter(where x->>'account'='available' and x->>'currency'=cur),0)
      from public.wallets w cross join jsonb_array_elements(p_entries) x
      where w.auth0_sub=p_auth0_sub and w.currency=cur group by available_minor)<0
      or (select savings_minor + coalesce(sum((x->>'amount_minor')::bigint) filter(where x->>'account'='savings' and x->>'currency'=cur),0)
      from public.wallets w cross join jsonb_array_elements(p_entries) x
      where w.auth0_sub=p_auth0_sub and w.currency=cur group by savings_minor)<0 then raise exception 'Insufficient wallet balance'; end if;
  end loop;
  insert into public.transactions(auth0_sub,request_id,request_fingerprint,kind,description,category,metadata)
    values(p_auth0_sub,p_request_id,p_request_fingerprint,p_kind,left(p_description,160),left(coalesce(p_category,'Other'),80),coalesce(p_metadata,'{}'::jsonb)) returning * into tx;
  for entry in select value from jsonb_array_elements(p_entries) loop
    cur:=entry->>'currency'; acct:=entry->>'account';
    insert into public.ledger_entries(transaction_id,auth0_sub,currency,account,amount_minor)
      values(tx.id,p_auth0_sub,cur,acct,(entry->>'amount_minor')::bigint);
  end loop;
  update public.wallets w set
    available_minor=available_minor+coalesce((select sum((e->>'amount_minor')::bigint) from jsonb_array_elements(p_entries) e where e->>'currency'=w.currency and e->>'account'='available'),0),
    savings_minor=savings_minor+coalesce((select sum((e->>'amount_minor')::bigint) from jsonb_array_elements(p_entries) e where e->>'currency'=w.currency and e->>'account'='savings'),0),updated_at=now()
    where w.auth0_sub=p_auth0_sub;
  return to_jsonb(tx);
end $$;

create or replace function public.walletwise_update_preferences(
  p_auth0_sub text,p_full_name text,p_preferred_currency text,
  p_savings_enabled boolean,p_currency_notifications boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.profiles;
begin
  if p_auth0_sub is null or length(p_auth0_sub) not between 1 and 512 then raise exception 'Invalid Auth0 subject'; end if;
  if p_full_name is null or length(btrim(p_full_name)) not between 1 and 60 then raise exception 'Invalid full name'; end if;
  if p_preferred_currency not in ('ILS','USD','JOD') then raise exception 'Invalid currency'; end if;
  perform public.walletwise_initialize_user(p_auth0_sub);
  update public.profiles set full_name=btrim(p_full_name),preferred_currency=p_preferred_currency,
    savings_enabled=p_savings_enabled,currency_notifications=coalesce(p_currency_notifications,false),
    updated_at=now() where auth0_sub=p_auth0_sub;
  update public.savings_rules set enabled=p_savings_enabled,updated_at=now() where auth0_sub=p_auth0_sub;
  select * into p from public.profiles where auth0_sub=p_auth0_sub;
  return to_jsonb(p);
end $$;

revoke all on function public.walletwise_initialize_user(text) from public,anon,authenticated;
revoke all on function public.walletwise_complete_onboarding(text,text,text,boolean,text,boolean,boolean) from public,anon,authenticated;
revoke all on function public.walletwise_apply_transaction(text,uuid,text,text,text,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.walletwise_update_preferences(text,text,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.walletwise_initialize_user(text) to service_role;
grant execute on function public.walletwise_complete_onboarding(text,text,text,boolean,text,boolean,boolean) to service_role;
grant execute on function public.walletwise_apply_transaction(text,uuid,text,text,text,text,jsonb,jsonb) to service_role;
grant execute on function public.walletwise_update_preferences(text,text,text,boolean,boolean) to service_role;


-- A new request key must never refund the same purchase a second time.
create unique index one_refund_per_purchase on public.transactions(auth0_sub,(metadata->>'originalId')) where kind='refund';
create index ledger_owner_transaction on public.ledger_entries(auth0_sub,transaction_id);
create index transactions_owner_time on public.transactions(auth0_sub,occurred_at desc);
create index goals_owner on public.savings_goals(auth0_sub);
create index allocations_owner on public.savings_allocations(auth0_sub);
create index alerts_owner on public.currency_alerts(auth0_sub);
create index notifications_owner on public.notifications(auth0_sub);
create index reports_owner on public.ai_reports(auth0_sub);
