-- Run the entire file in Supabase SQL Editor as postgres.
-- Intended starting state: forex_snapshots may exist; wallet tables must be absent.
-- Conflicting wallet objects abort the transaction instead of being overwritten.
-- This is a bootstrap, not a rerunnable upgrade of an existing wallet installation.
BEGIN;
SELECT pg_advisory_xact_lock(20261030, 4261);
DO $preflight$
DECLARE name text; col record; actual_type text; required boolean;
BEGIN
  FOREACH name IN ARRAY ARRAY['profiles','wallets','transactions','ledger_entries','savings_rules','savings_goals','savings_allocations','exchange_rates','currency_alerts','notifications','ai_reports','account_state','funding_orders','savings_circles','circle_members','circle_invitations','circle_proposals','circle_votes','circle_entries','circle_activity','circle_operations','goal_savings_entries','savings_quotes','one_refund_per_purchase','ledger_owner_transaction','transactions_owner_time','goals_owner','allocations_owner','alerts_owner','notifications_owner','reports_owner','funding_owner_time','reports_input_status','transactions_owner_cursor','transactions_owner_goal','funding_owner_cursor','circle_one_locked_request','circle_member_owner','circle_entry_time','circle_activity_time','circle_invitation_owner','one_circle_merchant_refund','goal_entry_owner','goal_entry_destination'] LOOP
    IF to_regclass('public.' || name) IS NOT NULL THEN
      RAISE EXCEPTION 'Schema conflict: public.% already exists. No changes committed. Inspect existing objects before applying wallet migrations.', name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE (n.nspname='public' AND p.proname IN ('walletwise_initialize_user','walletwise_complete_onboarding','walletwise_apply_transaction','walletwise_update_preferences','walletwise_patch_preferences','walletwise_accept_savings_rule','walletwise_funding_reserve','walletwise_funding_status','walletwise_funding_credit','walletwise_funding_reverse','walletwise_funding_review','walletwise_dashboard','walletwise_activity_page','walletwise_report_page','walletwise_patch_preferences','walletwise_create_savings_goal','walletwise_archive_savings_goal','walletwise_purchase','walletwise_dashboard','walletwise_accept_savings_rule','walletwise_set_savings_destination','walletwise_assign_historical','walletwise_goal_purchase','walletwise_purchase','walletwise_circle_contribute','walletwise_invitation_preview','walletwise_circle_command','walletwise_circles','walletwise_patch_preferences','walletwise_savings_options','walletwise_goal_refund','walletwise_own_circle_ledger','walletwise_dashboard','walletwise_create_savings_goal','walletwise_archive_savings_goal','walletwise_invitation_status','walletwise_join_circle'))
       OR (n.nspname='private' AND p.proname='auth0_subject')) THEN
    RAISE EXCEPTION 'Schema conflict: a wallet function already exists. No changes committed. Inspect it before applying this bootstrap.';
  END IF;
  IF to_regclass('public.forex_snapshots') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=to_regclass('public.forex_snapshots') AND relkind='r') THEN
      RAISE EXCEPTION 'Schema conflict: public.forex_snapshots must be an ordinary table';
    END IF;
    FOR col IN SELECT * FROM (VALUES ('id','text'),('observed_at','timestamp with time zone'),('fetched_at','timestamp with time zone'),('snapshot','jsonb')) AS expected(name,type) LOOP
      SELECT format_type(a.atttypid,a.atttypmod),a.attnotnull INTO actual_type,required
        FROM pg_attribute a WHERE a.attrelid=to_regclass('public.forex_snapshots') AND a.attname=col.name AND a.attnum>0 AND NOT a.attisdropped;
      IF actual_type IS DISTINCT FROM col.type OR required IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Schema conflict: forex_snapshots.% must be % NOT NULL; existing data has not been changed', col.name,col.type;
      END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='id'
      WHERE c.conrelid=to_regclass('public.forex_snapshots') AND c.contype='p' AND c.conkey=ARRAY[a.attnum]) THEN
      RAISE EXCEPTION 'Schema conflict: forex_snapshots requires a primary key on id';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('public.forex_snapshots') AND a.attnum>0 AND NOT a.attisdropped
      AND a.attname NOT IN ('id','observed_at','fetched_at','snapshot') AND a.attnotnull AND NOT a.atthasdef AND a.attidentity='' AND a.attgenerated='') THEN
      RAISE EXCEPTION 'Schema conflict: forex_snapshots has extra required columns without defaults';
    END IF;
  ELSIF to_regclass('public.forex_snapshots_observed_idx') IS NOT NULL THEN
    RAISE EXCEPTION 'Schema conflict: forex_snapshots_observed_idx exists without forex_snapshots';
  END IF;
  IF to_regclass('public.forex_snapshots_observed_idx') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.forex_snapshots_observed_idx') AND indrelid=to_regclass('public.forex_snapshots') AND indisvalid
  ) THEN
    RAISE EXCEPTION 'Schema conflict: forex_snapshots_observed_idx is not a valid index on forex_snapshots';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='forex_history'
    AND (p.oid IS DISTINCT FROM to_regprocedure('public.forex_history(timestamptz,integer)')
      OR p.prorettype<>'jsonb'::regtype OR NOT p.proretset OR p.prosecdef
      OR regexp_replace(p.prosrc,'\s','','g')<>regexp_replace('
 select snapshot from (
  select distinct on (floor(extract(epoch from observed_at)/greatest(p_bucket_seconds,60))) snapshot, observed_at
  from public.forex_snapshots where observed_at >= p_since
  order by floor(extract(epoch from observed_at)/greatest(p_bucket_seconds,60)), observed_at desc, fetched_at desc
 ) points order by observed_at asc limit 500;
','\s','','g'))) THEN
    RAISE EXCEPTION 'Schema conflict: existing forex_history differs from the expected function; it will not be overwritten';
  END IF;
END $preflight$;

-- Migration: 202610260001_walletwise_core.sql
-- WalletWise relational core. Auth0 subjects are opaque text, never UUIDs.
create extension if not exists pgcrypto;
create schema if not exists private;


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

-- Expose only RLS-filtered reads on the new app tables to clients.
revoke all on public.profiles, public.wallets, public.transactions, public.ledger_entries, public.savings_rules, public.savings_goals, public.savings_allocations, public.exchange_rates, public.currency_alerts, public.notifications, public.ai_reports from public, anon, authenticated, service_role;
-- Permissions are scoped to the app objects created by this bootstrap.
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


-- Migration: 202610260002_wallet_preferences.sql
-- Persist the remaining existing UI preferences without overwriting omitted fields.
alter table public.profiles add column wallet_preferences jsonb not null default '{}'::jsonb
  check(jsonb_typeof(wallet_preferences)='object');
create function public.walletwise_patch_preferences(p_auth0_sub text,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles; c text;
begin
  if jsonb_typeof(p_patch) <> 'object' or p_patch is null then raise exception 'Invalid preferences'; end if;
  if exists(select 1 from jsonb_object_keys(p_patch) k where k not in
    ('name','preferred','savings','notifications','increments','caps','goalIds','frequency')) then raise exception 'Unknown preference'; end if;
  select * into strict p from public.profiles where auth0_sub=p_auth0_sub for update;
  if p.onboarding_completed_at is null then raise exception 'Complete onboarding first'; end if;
  if p_patch ? 'savings' and p_patch->>'savings' not in ('enabled','disabled') then raise exception 'Invalid savings preference'; end if;
  if p_patch ? 'frequency' and p_patch->>'frequency' not in ('weekly','monthly') then raise exception 'Invalid report frequency'; end if;
  update public.profiles set
    full_name=coalesce(p_patch->>'name',full_name),
    preferred_currency=coalesce(p_patch->>'preferred',preferred_currency),
    savings_enabled=case when p_patch ? 'savings' then p_patch->>'savings'='enabled' else savings_enabled end,
    currency_notifications=coalesce((p_patch->>'notifications')::boolean,currency_notifications),
    wallet_preferences=wallet_preferences || (p_patch - array['name','preferred','savings','notifications']),
    updated_at=now() where auth0_sub=p_auth0_sub returning * into p;
  foreach c in array array['ILS','USD','JOD'] loop
    update public.savings_rules set enabled=p.savings_enabled,
      increment_minor=coalesce((p_patch->'increments'->>c)::bigint,increment_minor),
      cap_minor=coalesce((p_patch->'caps'->>c)::bigint,cap_minor),updated_at=now()
      where auth0_sub=p_auth0_sub and currency=c;
  end loop;
  return to_jsonb(p);
end $$;
revoke all on function public.walletwise_patch_preferences(text,jsonb) from public,anon,authenticated;
grant execute on function public.walletwise_patch_preferences(text,jsonb) to service_role;


-- Migration: 202610260003_accept_savings_rule.sql
-- Repair acceptance of existing report recommendations when PostgreSQL is enabled.
-- No data deletion or balance changes. Compare-and-set under the financial locks.
create function public.walletwise_accept_savings_rule(
  p_auth0_sub text, p_currency text, p_current bigint, p_cap bigint,
  p_suggested bigint, p_ledger_revision text
) returns void language plpgsql security definer set search_path='' as $$
declare p public.profiles; r public.savings_rules; revision text;
begin
  select * into strict p from public.profiles where auth0_sub=p_auth0_sub for update;
  perform 1 from public.wallets where auth0_sub=p_auth0_sub order by currency for update;
  select * into strict r from public.savings_rules where auth0_sub=p_auth0_sub and currency=p_currency for update;
  select id::text into revision from public.transactions where auth0_sub=p_auth0_sub
    order by occurred_at desc,id desc limit 1;
  if not coalesce(p.savings_enabled,false) or not r.enabled or r.cap_minor<>p_cap
    or r.increment_minor not in (p_current,p_suggested)
    or coalesce(revision,'') is distinct from p_ledger_revision then
    raise exception 'Savings settings changed';
  end if;
  if p_current is null or p_current<=0 or p_suggested is null or p_suggested<>p_current*2
    or p_suggested>(case when p_currency='JOD' then 1000000 else 100000 end) then
    raise exception 'Invalid savings recommendation';
  end if;
  update public.savings_rules set increment_minor=p_suggested,updated_at=now()
    where auth0_sub=p_auth0_sub and currency=p_currency;
  update public.profiles set wallet_preferences=wallet_preferences || jsonb_build_object(
    'increments',(select jsonb_object_agg(currency,increment_minor) from public.savings_rules where auth0_sub=p_auth0_sub)
  ),updated_at=now() where auth0_sub=p_auth0_sub;
end $$;
revoke all on function public.walletwise_accept_savings_rule(text,text,bigint,bigint,bigint,text) from public,anon,authenticated;
grant execute on function public.walletwise_accept_savings_rule(text,text,bigint,bigint,bigint,text) to service_role;


-- Migration: 202610290001_forex_snapshots.sql
-- Separate from legacy PMA records; preserves original exchange_rates and integration identifiers.
create table if not exists public.forex_snapshots (
 id text primary key,
 observed_at timestamptz not null,
 fetched_at timestamptz not null,
 snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object')
);
create index if not exists forex_snapshots_observed_idx on public.forex_snapshots(observed_at desc);
alter table public.forex_snapshots enable row level security;
revoke all on public.forex_snapshots from public,anon,authenticated,service_role;
grant select on public.forex_snapshots to authenticated;
DO $policy$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.forex_snapshots'::regclass AND polname='forex_read') THEN
    CREATE POLICY forex_read ON public.forex_snapshots FOR SELECT TO authenticated USING (true);
  END IF;
END $policy$;
grant select,insert on public.forex_snapshots to service_role;
DO $function$ BEGIN
  IF to_regprocedure('public.forex_history(timestamptz,integer)') IS NULL THEN
    EXECUTE $definition$create function public.forex_history(p_since timestamptz,p_bucket_seconds integer)
returns setof jsonb language sql stable security invoker set search_path='' as $$
 select snapshot from (
  select distinct on (floor(extract(epoch from observed_at)/greatest(p_bucket_seconds,60))) snapshot, observed_at
  from public.forex_snapshots where observed_at >= p_since
  order by floor(extract(epoch from observed_at)/greatest(p_bucket_seconds,60)), observed_at desc, fetched_at desc
 ) points order by observed_at asc limit 500;
$$;$definition$;
  END IF;
END $function$;
revoke all on function public.forex_history(timestamptz,integer) from public,anon,authenticated;
grant execute on function public.forex_history(timestamptz,integer) to service_role;


-- Migration: 202610300001_account_state_funding.sql
-- Additive only. Existing accounts, balances and transactions are preserved.
create table public.account_state (
  user_id text primary key,
  auth0_sub text not null unique references public.profiles(auth0_sub),
  version bigint not null default 0,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.account_state enable row level security;
create policy own_account_state on public.account_state for select to authenticated
  using(auth0_sub=(select private.auth0_subject()));
revoke all on public.account_state from public,anon,authenticated;
grant select on public.account_state to authenticated;
grant select,insert,update on public.account_state to service_role;

create table public.funding_orders (
  id uuid primary key default gen_random_uuid(),
  auth0_sub text not null references public.profiles(auth0_sub),
  request_id uuid not null,
  fingerprint text not null,
  currency text not null check(currency in ('USD','ILS')),
  amount_minor bigint not null check(amount_minor between 100 and 10000000),
  status text not null default 'CREATING' check(status in ('CREATING','CREATED','PENDING','COMPLETED','CANCELED','FAILED','RECONCILE','REVERSED','REFUND_REVIEW')),
  provider_order_id text unique,
  capture_id text unique,
  transaction_id uuid unique references public.transactions(id),
  reversal_id uuid unique references public.transactions(id),
  approval_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(auth0_sub,request_id), unique(id,auth0_sub)
);
alter table public.funding_orders enable row level security;
create policy own_funding on public.funding_orders for select to authenticated
  using(auth0_sub=(select private.auth0_subject()));
revoke all on public.funding_orders from public,anon,authenticated;
grant select on public.funding_orders to authenticated,service_role;

create function public.walletwise_funding_reserve(p_sub text,p_key uuid,p_fingerprint text,p_currency text,p_amount bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.funding_orders;
begin
  perform public.walletwise_initialize_user(p_sub);
  insert into public.funding_orders(auth0_sub,request_id,fingerprint,currency,amount_minor)
    values(p_sub,p_key,p_fingerprint,p_currency,p_amount) on conflict(auth0_sub,request_id) do nothing;
  select * into strict o from public.funding_orders where auth0_sub=p_sub and request_id=p_key for update;
  if o.fingerprint<>p_fingerprint or o.currency<>p_currency or o.amount_minor<>p_amount then raise exception 'Idempotency key reused with different request'; end if;
  return to_jsonb(o);
end $$;

create function public.walletwise_funding_status(p_sub text,p_id uuid,p_status text,p_order text default null,p_url text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.funding_orders;
begin
  select * into strict o from public.funding_orders where id=p_id and auth0_sub=p_sub for update;
  if o.provider_order_id is not null and p_order is not null and o.provider_order_id<>p_order then raise exception 'Order mismatch'; end if;
  if p_status not in ('CREATED','PENDING','CANCELED','FAILED','RECONCILE') then raise exception 'Invalid funding status'; end if;
  if o.status in ('COMPLETED','REVERSED','REFUND_REVIEW') then return to_jsonb(o); end if;
  -- Canceled/failed orders may still be reconciled against a genuine capture.
  update public.funding_orders set status=p_status,provider_order_id=coalesce(provider_order_id,p_order),approval_url=coalesce(p_url,approval_url),updated_at=now()
    where id=o.id returning * into o;
  return to_jsonb(o);
end $$;

create function public.walletwise_funding_credit(p_sub text,p_id uuid,p_capture text,p_currency text,p_amount bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.funding_orders; t jsonb;
begin
  select * into strict o from public.funding_orders where id=p_id and auth0_sub=p_sub for update;
  if o.provider_order_id is null or p_capture is null or length(p_capture) not between 1 and 64 or o.currency<>p_currency or o.amount_minor<>p_amount then raise exception 'Funding verification mismatch'; end if;
  if o.capture_id is not null and o.capture_id<>p_capture then raise exception 'Capture mismatch'; end if;
  if o.transaction_id is not null then return to_jsonb(o); end if;
  -- Updating capture_id first claims the globally unique provider transaction.
  -- Its constraint and the ledger write participate in this same transaction.
  update public.funding_orders set capture_id=p_capture where id=o.id;
  t:=public.walletwise_apply_transaction(p_sub,o.id,'funding:'||o.id,'adjustment','Funds Added','Funding',
    jsonb_build_array(jsonb_build_object('currency',o.currency,'account','available','amount_minor',o.amount_minor),
      jsonb_build_object('currency',o.currency,'account','external','amount_minor',-o.amount_minor)),
    jsonb_build_object('fundingId',o.id,'provider','PayPal','providerOrderId',o.provider_order_id,'captureId',p_capture,'status','COMPLETED'));
  update public.funding_orders set status='COMPLETED',transaction_id=(t->>'id')::uuid,updated_at=now() where id=o.id returning * into o;
  return to_jsonb(o);
end $$;

create function public.walletwise_funding_reverse(p_sub text,p_id uuid,p_capture text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.funding_orders; t jsonb; k uuid;
begin
  select * into strict o from public.funding_orders where id=p_id and auth0_sub=p_sub for update;
  if o.capture_id is distinct from p_capture or o.transaction_id is null then raise exception 'Capture mismatch'; end if;
  if o.reversal_id is not null then return to_jsonb(o); end if;
  perform 1 from public.wallets where auth0_sub=p_sub order by currency for update;
  if (select available_minor from public.wallets where auth0_sub=p_sub and currency=o.currency)<o.amount_minor then
    update public.funding_orders set status='REFUND_REVIEW',updated_at=now() where id=o.id returning * into o;
    return to_jsonb(o);
  end if;
  k:=gen_random_uuid();
  t:=public.walletwise_apply_transaction(p_sub,k,'reversal:'||o.id,'adjustment','Funding reversed','Funding',
    jsonb_build_array(jsonb_build_object('currency',o.currency,'account','available','amount_minor',-o.amount_minor),
      jsonb_build_object('currency',o.currency,'account','external','amount_minor',o.amount_minor)),
    jsonb_build_object('fundingId',o.id,'reversal',true,'captureId',p_capture,'provider','PayPal','status','REVERSED'));
  update public.funding_orders set status='REVERSED',reversal_id=(t->>'id')::uuid,updated_at=now() where id=o.id returning * into o;
  return to_jsonb(o);
end $$;
revoke all on function public.walletwise_funding_reserve(text,uuid,text,text,bigint),public.walletwise_funding_status(text,uuid,text,text,text),public.walletwise_funding_credit(text,uuid,text,text,bigint),public.walletwise_funding_reverse(text,uuid,text) from public,anon,authenticated;
grant execute on function public.walletwise_funding_reserve(text,uuid,text,text,bigint),public.walletwise_funding_status(text,uuid,text,text,text),public.walletwise_funding_credit(text,uuid,text,text,bigint),public.walletwise_funding_reverse(text,uuid,text) to service_role;
create index funding_owner_time on public.funding_orders(auth0_sub,created_at desc);
create function public.walletwise_funding_review(p_sub text,p_id uuid)
returns void language sql security definer set search_path='' as $$
  update public.funding_orders set status='REFUND_REVIEW',updated_at=now() where id=p_id and auth0_sub=p_sub and transaction_id is not null
$$;
revoke all on function public.walletwise_funding_review(text,uuid) from public,anon,authenticated;
grant execute on function public.walletwise_funding_review(text,uuid) to service_role;


-- Migration: 202610300002_gemini_reports.sql
-- Preserve old reports and their existing ownership RLS. Browser writes remain denied.
alter table public.ai_reports
  add column period_start timestamptz,
  add column period_end timestamptz,
  add column model text,
  add column prompt_version text,
  add column input_fingerprint text,
  add column status text check(status in ('complete','ai_unavailable','empty')),
  add column recommendations jsonb not null default '[]'::jsonb;
create unique index reports_input_status on public.ai_reports(auth0_sub,input_fingerprint,status);
grant insert,update on public.ai_reports to service_role;


-- Migration: 202610300003_progressive_loading.sql
-- Read-only projections. No balances, financial functions or RLS are changed.
create index transactions_owner_cursor on public.transactions(auth0_sub,occurred_at desc,id desc);
create index transactions_owner_goal on public.transactions(auth0_sub,(metadata->>'goalId')) where metadata->>'goalId' is not null;
create index funding_owner_cursor on public.funding_orders(auth0_sub,created_at desc,id desc) where transaction_id is null;

create function public.walletwise_dashboard(p_sub text,p_uid text,p_timezone text default 'UTC')
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'createdAt',a.state->'createdAt','goals',coalesce(a.state->'goals','[]'),
 'alerts',coalesce(a.state->'alerts','[]'),'notices',coalesce(a.state->'notices','[]'),
 'reportTotal',jsonb_array_length(coalesce(a.state->'reports','[]')),'reports',(select coalesce(jsonb_agg(r.value),'[]') from (select value from jsonb_array_elements(coalesce(a.state->'reports','[]')) limit 5) r),
 'recommendations',coalesce(a.state->'recommendations','[]'),
 'dashboard',jsonb_build_object(
   'dailySpending',(select coalesce(jsonb_agg(jsonb_build_object('day',d.day,'currency',d.currency,'amount',d.amount::text)),'[]') from (
     select (t.occurred_at at time zone p_timezone)::date as day,l.currency,sum(l.amount_minor) as amount
     from public.transactions t join public.ledger_entries l on l.transaction_id=t.id and l.auth0_sub=t.auth0_sub
     where t.auth0_sub=p_sub and t.kind='purchase' and l.account='external'
       and t.occurred_at>=((now() at time zone p_timezone)::date-31)::timestamp at time zone p_timezone
     group by 1,2) d),
   'goalTotals',(select coalesce(jsonb_object_agg(g.goal,g.amount::text),'{}') from (
     select t.metadata->>'goalId' as goal,sum(case when t.kind='refund' then -abs(x.saved) else abs(x.saved) end) as amount
     from public.transactions t cross join lateral (select coalesce(sum(l.amount_minor),0) as saved from public.ledger_entries l where l.transaction_id=t.id and l.auth0_sub=t.auth0_sub and l.account='savings') x
     where t.auth0_sub=p_sub and t.metadata->>'goalId' is not null group by 1) g)))
 from public.account_state a where a.user_id=p_uid and a.auth0_sub=p_sub;
$$;

create function public.walletwise_activity_page(p_sub text,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 25,p_currency text default null,p_category text default null,p_savings boolean default false,p_from timestamptz default null,p_until timestamptz default null)
returns jsonb language sql stable security definer set search_path='' as $$
 with events as (
  select t.id,t.occurred_at,'transaction' as source from public.transactions t
  where t.auth0_sub=p_sub and t.kind<>'opening'
    and (p_category is null or t.category=p_category)
    and (p_currency is null or exists(select 1 from public.ledger_entries l where l.transaction_id=t.id and l.auth0_sub=p_sub and l.currency=p_currency))
    and (not p_savings or exists(select 1 from public.ledger_entries l where l.transaction_id=t.id and l.auth0_sub=p_sub and l.account='savings' and l.amount_minor<>0))
  union all
  select f.id,f.created_at,'funding' from public.funding_orders f
  where f.auth0_sub=p_sub and f.transaction_id is null and not p_savings
    and (p_category is null or p_category='Funding') and (p_currency is null or f.currency=p_currency)
 ), page as (
  select * from events where (p_before is null or (occurred_at,id)<(p_before,p_before_id)) and (p_from is null or occurred_at>=p_from) and (p_until is null or occurred_at<p_until)
  order by occurred_at desc,id desc limit least(101,greatest(1,p_limit))
 )
 select coalesce(jsonb_agg(case when e.source='funding' then
   (select jsonb_build_object('funding',to_jsonb(f),'occurred_at',e.occurred_at,'id',e.id) from public.funding_orders f where f.id=e.id and f.auth0_sub=p_sub)
 else
   (select to_jsonb(t)||jsonb_build_object('ledger_entries',(select jsonb_agg(jsonb_build_object('currency',l.currency,'account',l.account,'amount_minor',l.amount_minor::text)) from public.ledger_entries l where l.transaction_id=t.id and l.auth0_sub=p_sub)) from public.transactions t where t.id=e.id and t.auth0_sub=p_sub)
 end order by e.occurred_at desc,e.id desc),'[]') from page e;
$$;

create function public.walletwise_report_page(p_sub text,p_uid text,p_offset integer default 0,p_limit integer default 10)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('reports',(select coalesce(jsonb_agg(r.value),'[]') from (
   select value from jsonb_array_elements(coalesce(a.state->'reports','[]')) with ordinality r(value,n)
   order by n offset greatest(0,p_offset) limit least(50,greatest(1,p_limit))) r),
   'total',jsonb_array_length(coalesce(a.state->'reports','[]')))
 from public.account_state a where a.user_id=p_uid and a.auth0_sub=p_sub;
$$;
revoke all on function public.walletwise_dashboard(text,text,text),public.walletwise_activity_page(text,timestamptz,uuid,integer,text,text,boolean,timestamptz,timestamptz),public.walletwise_report_page(text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.walletwise_dashboard(text,text,text),public.walletwise_activity_page(text,timestamptz,uuid,integer,text,text,boolean,timestamptz,timestamptz),public.walletwise_report_page(text,text,integer,integer) to service_role;


-- Migration: 202610310001_savings_destinations.sql
-- Savings are already posted to wallets.savings_minor and ledger_entries.
-- General Savings is the permanent, unearmarked subaccount of that ledger,
-- not a second balance to fund. This migration creates no financial postings.
alter table public.savings_goals add column archived_at timestamptz;

-- Validate imported auxiliary records without relying on a PostgreSQL version
-- specific input-validation function. Invalid rows remain in the audit queue.
create function private.valid_savings_goal(g jsonb) returns boolean
language plpgsql stable set search_path='' as $$
begin
 if jsonb_typeof(g)<>'object' or coalesce(g->>'currency','') not in ('ILS','USD','JOD')
   or coalesce(length(g->>'name'),0) not between 1 and 60
   or g->>'id' is null or g->>'createdAt' is null or g->>'target' is null then return false; end if;
 perform (g->>'id')::uuid;
 perform (g->>'createdAt')::timestamptz;
 perform (g->>'targetDate')::date;
 return (g->>'target')::bigint between 1 and 9007199254740991;
exception when others then return false;
end $$;
revoke all on function private.valid_savings_goal(jsonb) from public,anon,authenticated,service_role;

-- Preserve auxiliary goal IDs so historical transaction metadata still joins.
-- Invalid/conflicting legacy records remain untouched and appear in the audit.
insert into public.savings_goals(id,auth0_sub,currency,name,target_minor,target_date,created_at)
select (g->>'id')::uuid,a.auth0_sub,g->>'currency',g->>'name',
  (g->>'target')::bigint,(g->>'targetDate')::date,(g->>'createdAt')::timestamptz
from public.account_state a cross join lateral jsonb_array_elements(coalesce(a.state->'goals','[]')) g
where private.valid_savings_goal(g)
  and exists(select 1 from public.wallets w where w.auth0_sub=a.auth0_sub and w.currency=g->>'currency')
on conflict(id) do nothing;

-- Accounts copied lazily from legacy auxiliary storage after this migration
-- must receive the same non-financial goal import. Existing goal rows win.
create function private.import_account_savings_goals() returns trigger
language plpgsql security definer set search_path='' as $$
begin
insert into public.savings_goals(id,auth0_sub,currency,name,target_minor,target_date,created_at)
select (g->>'id')::uuid,new.auth0_sub,g->>'currency',g->>'name',
  (g->>'target')::bigint,(g->>'targetDate')::date,(g->>'createdAt')::timestamptz
from jsonb_array_elements(coalesce(new.state->'goals','[]')) g
where private.valid_savings_goal(g)
  and exists(select 1 from public.wallets w where w.auth0_sub=new.auth0_sub and w.currency=g->>'currency')
on conflict(id) do nothing;
 return new;
end $$;
revoke all on function private.import_account_savings_goals() from public,anon,authenticated,service_role;
create trigger account_savings_goals_insert after insert on public.account_state
 for each row execute function private.import_account_savings_goals();
create trigger account_savings_goals_update after update of state on public.account_state
 for each row when (old.state->'goals' is distinct from new.state->'goals') execute function private.import_account_savings_goals();


-- Each savings posting is its allocation. Signed amounts preserve refunds;
-- a missing goalId means General Savings, including historical round-ups.
create view public.savings_destination_balances with (security_invoker=true) as
with allocations as (
  select l.auth0_sub,l.currency,nullif(t.metadata->>'goalId','') as goal_id,sum(l.amount_minor) as amount
  from public.ledger_entries l join public.transactions t on t.id=l.transaction_id and t.auth0_sub=l.auth0_sub
  where l.account='savings' group by 1,2,3
)
select w.auth0_sub,w.currency,null::text as goal_id,coalesce(a.amount,0)::bigint as amount_minor
from public.wallets w left join allocations a on a.auth0_sub=w.auth0_sub and a.currency=w.currency and a.goal_id is null
union all
select auth0_sub,currency,goal_id,amount::bigint from allocations where goal_id is not null;
revoke all on public.savings_destination_balances from public,anon,authenticated,service_role;
grant select on public.savings_destination_balances to authenticated,service_role;

-- Read-only reconciliation queue. Never guess an orphan's destination or
-- alter a wallet to make an inconsistent record appear balanced.
create view public.savings_reconciliation_issues with (security_invoker=true) as
select b.auth0_sub,b.currency,b.goal_id,'Unknown or mismatched historical goal'::text as issue,b.amount_minor
from public.savings_destination_balances b where b.goal_id is not null and not exists(
  select 1 from public.savings_goals g where g.id::text=b.goal_id and g.auth0_sub=b.auth0_sub and g.currency=b.currency)
union all
select w.auth0_sub,w.currency,null,'Wallet and savings ledger differ',
 w.savings_minor-coalesce((select sum(l.amount_minor) from public.ledger_entries l where l.auth0_sub=w.auth0_sub and l.currency=w.currency and l.account='savings'),0)
from public.wallets w where w.savings_minor<>coalesce((select sum(l.amount_minor) from public.ledger_entries l where l.auth0_sub=w.auth0_sub and l.currency=w.currency and l.account='savings'),0)
union all
select a.auth0_sub,g->>'currency',g->>'id','Auxiliary goal requires manual reconciliation',0::bigint
from public.account_state a cross join lateral jsonb_array_elements(coalesce(a.state->'goals','[]')) g
where not exists(select 1 from public.savings_goals r where r.id::text=g->>'id' and r.auth0_sub=a.auth0_sub and r.currency=g->>'currency' and r.name=g->>'name' and r.target_minor::text=g->>'target')
union all
select a.auth0_sub,a.currency,a.goal_id::text,'Legacy savings allocation requires verification',a.amount_minor
from public.savings_allocations a where a.transaction_id is null or not exists(
 select 1 from public.transactions t join public.ledger_entries l on l.transaction_id=t.id and l.auth0_sub=t.auth0_sub
 where t.id=a.transaction_id and t.auth0_sub=a.auth0_sub and t.metadata->>'goalId'=a.goal_id::text
 and l.account='savings' and l.currency=a.currency and l.amount_minor=a.amount_minor);
revoke all on public.savings_reconciliation_issues from public,anon,authenticated,service_role;
grant select on public.savings_reconciliation_issues to authenticated,service_role;

create function private.savings_goal_eligible(p_sub text,p_currency text,p_goal text)
returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.savings_goals g where g.auth0_sub=p_sub
   and g.currency=p_currency and g.id::text=p_goal and g.archived_at is null
   and g.target_minor>coalesce((select sum(b.amount_minor) from public.savings_destination_balances b
     where b.auth0_sub=p_sub and b.currency=p_currency and b.goal_id=p_goal),0));
$$;
revoke all on function private.savings_goal_eligible(text,text,text) from public,anon,authenticated,service_role;

-- Legacy preference callers also get per-currency validation and serialization.
-- A null map value clears a default; omitted currencies remain unchanged.
alter function public.walletwise_patch_preferences(text,jsonb) rename to walletwise_patch_preferences_before_destinations;
revoke all on function public.walletwise_patch_preferences_before_destinations(text,jsonb) from public,anon,authenticated,service_role;
create function public.walletwise_patch_preferences(p_auth0_sub text,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c text; prior jsonb; merged jsonb;
begin
 perform public.walletwise_initialize_user(p_auth0_sub);
 perform 1 from public.wallets where auth0_sub=p_auth0_sub order by currency for update;
 select coalesce(wallet_preferences->'goalIds','{}') into prior from public.profiles where auth0_sub=p_auth0_sub for update;
 if p_patch ? 'goalIds' then
   if jsonb_typeof(p_patch->'goalIds')<>'object' then raise exception 'Select a valid savings destination'; end if;
   for c in select jsonb_object_keys(p_patch->'goalIds') loop
     if c not in ('ILS','USD','JOD') or ((p_patch->'goalIds'->>c) is not null and not private.savings_goal_eligible(p_auth0_sub,c,p_patch->'goalIds'->>c)) then
       raise exception 'Select an eligible goal in the matching currency';
     end if;
   end loop;
   merged:=coalesce(prior,'{}') || (p_patch->'goalIds');
   p_patch:=jsonb_set(p_patch,'{goalIds}',merged);
 end if;
 return public.walletwise_patch_preferences_before_destinations(p_auth0_sub,p_patch);
end $$;

create function public.walletwise_create_savings_goal(p_sub text,p_uid text,p_key uuid,p_fingerprint text,p_goal jsonb,p_default boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.account_state; prior jsonb; g public.savings_goals; result jsonb;
begin
 perform public.walletwise_initialize_user(p_sub);
 perform 1 from public.wallets where auth0_sub=p_sub order by currency for update;
 select * into strict a from public.account_state where auth0_sub=p_sub and user_id=p_uid for update;
 prior:=a.state->'operations'->p_key::text;
 if prior is not null then
   if prior->>'fingerprint'<>p_fingerprint then raise exception 'Idempotency key reused with different request'; end if;
   return prior->'result';
 end if;
 if (select count(*) from public.savings_goals where auth0_sub=p_sub and archived_at is null)>=25 then raise exception 'Maximum 25 goals'; end if;
 insert into public.savings_goals(auth0_sub,currency,name,target_minor,target_date)
 values(p_sub,p_goal->>'currency',p_goal->>'name',(p_goal->>'target')::bigint,(p_goal->>'targetDate')::date) returning * into g;
 result:=jsonb_strip_nulls(jsonb_build_object('id',g.id,'currency',g.currency,'name',g.name,'target',g.target_minor,'targetDate',g.target_date,'createdAt',g.created_at));
 update public.account_state set state=jsonb_set(jsonb_set(state,'{goals}',coalesce(state->'goals','[]')||jsonb_build_array(result)),
   '{operations}',coalesce(state->'operations','{}')||jsonb_build_object(p_key::text,jsonb_build_object('fingerprint',p_fingerprint,'result',result))),version=version+1,updated_at=now()
 where user_id=p_uid and auth0_sub=p_sub;
 if p_default then perform public.walletwise_patch_preferences(p_sub,jsonb_build_object('goalIds',jsonb_build_object(g.currency,g.id))); end if;
 return result;
end $$;

-- Archiving is the deletion behavior: retain the goal and all historical money.
create function public.walletwise_archive_savings_goal(p_sub text,p_uid text,p_goal uuid)
returns void language plpgsql security definer set search_path='' as $$
declare g public.savings_goals;
begin
 perform 1 from public.wallets where auth0_sub=p_sub order by currency for update;
 perform 1 from public.account_state where auth0_sub=p_sub and user_id=p_uid for update;
 if not found then raise exception 'Select an owned goal'; end if;
 update public.savings_goals set archived_at=coalesce(archived_at,now()) where id=p_goal and auth0_sub=p_sub returning * into g;
 if not found then raise exception 'Select an owned goal'; end if;
 if (select wallet_preferences->'goalIds'->>g.currency from public.profiles where auth0_sub=p_sub)=g.id::text then
   perform public.walletwise_patch_preferences(p_sub,jsonb_build_object('goalIds',jsonb_build_object(g.currency,null)));
 end if;
 update public.account_state set state=jsonb_set(state,'{goals}',
   (select coalesce(jsonb_agg(case when x->>'id'=p_goal::text then x||'{"archived":true}'::jsonb else x end),'[]') from jsonb_array_elements(state->'goals') x)),
   version=version+1,updated_at=now() where auth0_sub=p_sub and user_id=p_uid;
end $$;

-- Read settings, select destination, calculate and post under the SAME lock.
-- No client-provided destination or savings amount is accepted.
create function public.walletwise_purchase(p_sub text,p_key uuid,p_fingerprint text,p_currency text,p_amount bigint,p_description text,p_category text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles; r public.savings_rules; prior public.transactions;
 saved bigint:=0; destination text; entries jsonb; result jsonb;
begin
 if p_currency not in ('ILS','USD','JOD') or p_amount is null or p_amount<=0 or p_amount>9007199254740991 then raise exception 'Amount is invalid'; end if;
 perform public.walletwise_initialize_user(p_sub);
 perform 1 from public.wallets where auth0_sub=p_sub order by currency for update;
 select * into prior from public.transactions where auth0_sub=p_sub and request_id=p_key;
 if found then
   if prior.request_fingerprint<>p_fingerprint then raise exception 'Idempotency key reused with different request'; end if;
   return to_jsonb(prior);
 end if;
 select * into strict p from public.profiles where auth0_sub=p_sub for update;
 select * into strict r from public.savings_rules where auth0_sub=p_sub and currency=p_currency;
 if p.savings_enabled and r.enabled then saved:=least((r.increment_minor-p_amount%r.increment_minor)%r.increment_minor,r.cap_minor); end if;
 destination:=p.wallet_preferences->'goalIds'->>p_currency;
 if not private.savings_goal_eligible(p_sub,p_currency,destination) then destination:=null; end if;
 entries:=jsonb_build_array(jsonb_build_object('currency',p_currency,'account','available','amount_minor',-p_amount-saved),
   jsonb_build_object('currency',p_currency,'account','external','amount_minor',p_amount));
 if saved>0 then entries:=entries||jsonb_build_array(jsonb_build_object('currency',p_currency,'account','savings','amount_minor',saved)); end if;
 result:=public.walletwise_apply_transaction(p_sub,p_key,p_fingerprint,'purchase',p_description,p_category,entries,
   jsonb_strip_nulls(jsonb_build_object('goalId',case when saved>0 then destination end,'savingsDestination',case when saved>0 then coalesce(destination,'general:'||p_currency) end)));
 -- Clear stale/completed defaults only after the posting succeeds. Any error
 -- rolls back this preference change together with the ledger and balances.
 if destination is null or not private.savings_goal_eligible(p_sub,p_currency,destination) then
   perform public.walletwise_patch_preferences(p_sub,jsonb_build_object('goalIds',jsonb_build_object(p_currency,null)));
 end if;
 return result;
end $$;

revoke all on function public.walletwise_patch_preferences(text,jsonb),public.walletwise_create_savings_goal(text,text,uuid,text,jsonb,boolean),public.walletwise_archive_savings_goal(text,text,uuid),public.walletwise_purchase(text,uuid,text,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.walletwise_patch_preferences(text,jsonb),public.walletwise_create_savings_goal(text,text,uuid,text,jsonb,boolean),public.walletwise_archive_savings_goal(text,text,uuid),public.walletwise_purchase(text,uuid,text,text,bigint,text,text) to service_role;

alter function public.walletwise_dashboard(text,text,text) rename to walletwise_dashboard_before_destinations;
revoke all on function public.walletwise_dashboard_before_destinations(text,text,text) from public,anon,authenticated,service_role;
create function public.walletwise_dashboard(p_sub text,p_uid text,p_timezone text default 'UTC')
returns jsonb language sql stable security definer set search_path='' as $$
 select case when d is null then null else jsonb_set(d,'{dashboard}',(d->'dashboard')||jsonb_build_object(
   'generalSavings',(select coalesce(jsonb_object_agg(currency,amount_minor::text),'{}') from public.savings_destination_balances where auth0_sub=p_sub and goal_id is null),
   'goalTotals',(select coalesce(jsonb_object_agg(goal_id,amount_minor::text),'{}') from public.savings_destination_balances where auth0_sub=p_sub and goal_id is not null))) end
 from public.walletwise_dashboard_before_destinations(p_sub,p_uid,p_timezone) d;
$$;
revoke all on function public.walletwise_dashboard(text,text,text) from public,anon,authenticated;
grant execute on function public.walletwise_dashboard(text,text,text) to service_role;


-- Use the same wallet -> profile -> rule lock order as purchases/defaults.
create or replace function public.walletwise_accept_savings_rule(
  p_auth0_sub text, p_currency text, p_current bigint, p_cap bigint,
  p_suggested bigint, p_ledger_revision text
) returns void language plpgsql security definer set search_path='' as $$
declare p public.profiles; r public.savings_rules; revision text;
begin
  perform 1 from public.wallets where auth0_sub=p_auth0_sub order by currency for update;
  select * into strict p from public.profiles where auth0_sub=p_auth0_sub for update;
  select * into strict r from public.savings_rules where auth0_sub=p_auth0_sub and currency=p_currency for update;
  select id::text into revision from public.transactions where auth0_sub=p_auth0_sub
    order by occurred_at desc,id desc limit 1;
  if not coalesce(p.savings_enabled,false) or not r.enabled or r.cap_minor<>p_cap
    or r.increment_minor not in (p_current,p_suggested)
    or coalesce(revision,'') is distinct from p_ledger_revision then
    raise exception 'Savings settings changed';
  end if;
  if p_current is null or p_current<=0 or p_suggested is null or p_suggested<>p_current*2
    or p_suggested>(case when p_currency='JOD' then 1000000 else 100000 end) then
    raise exception 'Invalid savings recommendation';
  end if;
  update public.savings_rules set increment_minor=p_suggested,updated_at=now()
    where auth0_sub=p_auth0_sub and currency=p_currency;
  update public.profiles set wallet_preferences=wallet_preferences || jsonb_build_object(
    'increments',(select jsonb_object_agg(currency,increment_minor) from public.savings_rules where auth0_sub=p_auth0_sub)
  ),updated_at=now() where auth0_sub=p_auth0_sub;
end $$;
revoke all on function public.walletwise_accept_savings_rule(text,text,bigint,bigint,bigint,text) from public,anon,authenticated;
grant execute on function public.walletwise_accept_savings_rule(text,text,bigint,bigint,bigint,text) to service_role;

notify pgrst, 'reload schema';


-- Migration: 202610310002_goal_savings_circles.sql
-- Depends on every preceding migration, including 202610310001. No resets.
-- Personal savings remain in the existing wallet ledger. Circle money is
-- removed from personal wallets and recorded in a separate locked subledger.
create table public.savings_circles (
 id uuid primary key default gen_random_uuid(), owner_sub text not null references public.profiles(auth0_sub),
 name text not null check(length(btrim(name)) between 1 and 60), description text not null default '' check(length(description)<=500),
 currency text not null check(currency in ('ILS','USD','JOD')), target_minor bigint not null check(target_minor between 1 and 9007199254740991),
 balance_minor bigint not null default 0 check(balance_minor between 0 and 9007199254740991), target_date date,
 icon text not null default 'users' check(icon in ('users','home','plane','heart','target')), archived boolean not null default false,
 reached_at timestamptz, created_at timestamptz not null default now()
);
create table public.circle_members (
 id uuid primary key default gen_random_uuid(),circle_id uuid not null references public.savings_circles(id),
 auth0_sub text not null references public.profiles(auth0_sub), display_name text not null,
 outstanding_minor bigint not null default 0 check(outstanding_minor between 0 and 9007199254740991),
 active boolean not null default true, joined_at timestamptz not null default now(),unique(circle_id,auth0_sub),unique(id,circle_id)
);
create table public.circle_invitations (
 id uuid primary key default gen_random_uuid(),circle_id uuid not null references public.savings_circles(id),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),expires_at timestamptz not null,revoked_at timestamptz,
 created_at timestamptz not null default now()
);
create table public.circle_proposals (
 id uuid primary key default gen_random_uuid(),circle_id uuid not null references public.savings_circles(id),
 kind text not null check(kind in ('withdraw','target','return_all','return_member','owner')),
 amount_minor bigint not null check(amount_minor between 0 and 9007199254740991),
 destination_member uuid references public.circle_members(id), reason text not null check(length(btrim(reason)) between 1 and 500),
 currency text not null check(currency in ('ILS','USD','JOD')),fee_minor bigint not null default 0 check(fee_minor=0),
 status text not null default 'Pending' check(status in ('Pending','Approved','Rejected','Canceled','Expired','Executing','Completed','Failed')),
 snapshot_total bigint not null check(snapshot_total>0),expires_at timestamptz not null default now()+interval '7 days',
 created_at timestamptz not null default now(),completed_at timestamptz,error text
);
create unique index circle_one_locked_request on public.circle_proposals(circle_id) where status in ('Pending','Approved','Executing','Failed');
create table public.circle_votes (
 proposal_id uuid not null references public.circle_proposals(id),member_id uuid not null references public.circle_members(id),
 share_minor bigint not null check(share_minor>0),decision text check(decision in ('Approve','Reject')),voted_at timestamptz,
 primary key(proposal_id,member_id)
);
create table public.circle_entries (
 id uuid primary key default gen_random_uuid(),circle_id uuid not null references public.savings_circles(id),member_id uuid not null,
 transaction_id uuid references public.transactions(id),proposal_id uuid references public.circle_proposals(id),
 amount_minor bigint not null check(amount_minor between -9007199254740991 and 9007199254740991 and amount_minor<>0),kind text not null check(kind in ('contribution','distribution','reversal')),
 created_at timestamptz not null default now(),foreign key(member_id,circle_id) references public.circle_members(id,circle_id),
 unique(transaction_id,member_id),unique(proposal_id,member_id),
 check((kind='contribution' and amount_minor>0)or(kind in ('distribution','reversal')and amount_minor<0))
);
create table public.circle_activity (
 id uuid primary key default gen_random_uuid(),circle_id uuid not null references public.savings_circles(id),
 member_id uuid references public.circle_members(id),event text not null,details jsonb not null default '{}',created_at timestamptz not null default now()
);
create table public.circle_operations (
 auth0_sub text not null references public.profiles(auth0_sub),request_id uuid not null,fingerprint text not null,result jsonb not null,
 primary key(auth0_sub,request_id)
);
create index circle_member_owner on public.circle_members(auth0_sub,circle_id);
create index circle_entry_time on public.circle_entries(circle_id,created_at desc);
create index circle_activity_time on public.circle_activity(circle_id,created_at desc);
create index circle_invitation_owner on public.circle_invitations(circle_id);
create unique index one_circle_merchant_refund on public.transactions(auth0_sub,(metadata->>'originalId')) where metadata->>'merchantRefund'='true';

-- One allocation per immutable savings posting, including negative refunds.
create table public.goal_savings_entries (
 ledger_entry_id uuid primary key references public.ledger_entries(id),auth0_sub text not null,
 currency text not null check(currency in ('ILS','USD','JOD')),goal_id uuid references public.savings_goals(id),
 legacy_goal_ref text,amount_minor bigint not null check(amount_minor<>0),
 foreign key(auth0_sub,currency) references public.wallets(auth0_sub,currency),
 check(not(goal_id is not null and legacy_goal_ref is not null))
);
insert into public.goal_savings_entries
select l.id,l.auth0_sub,l.currency,g.id,case when g.id is null then nullif(t.metadata->>'goalId','') end,l.amount_minor
from public.ledger_entries l join public.transactions t on t.id=l.transaction_id and t.auth0_sub=l.auth0_sub
left join public.savings_goals g on g.id::text=t.metadata->>'goalId' and g.auth0_sub=l.auth0_sub and g.currency=l.currency
where l.account='savings';
create index goal_entry_owner on public.goal_savings_entries(auth0_sub,currency,goal_id);
create index goal_entry_destination on public.goal_savings_entries(goal_id);
create function private.record_goal_savings() returns trigger language plpgsql security definer set search_path='' as $$
declare m jsonb; g public.savings_goals; reference text;
begin
 if new.account<>'savings' then return new; end if;
 select metadata into m from public.transactions where id=new.transaction_id and auth0_sub=new.auth0_sub;
 reference:=case when m ? 'reassign' then case when new.amount_minor>0 then m->>'goalId' else m->>'sourceGoal' end
   else coalesce(m->>'goalId',m->>'sourceGoal') end;
 select * into g from public.savings_goals where id::text=reference and auth0_sub=new.auth0_sub and currency=new.currency;
 if reference is not null and g.id is null then raise exception 'Savings destination unavailable'; end if;
 insert into public.goal_savings_entries values(new.id,new.auth0_sub,new.currency,g.id,null,new.amount_minor);
 if (select coalesce(sum(amount_minor),0) from public.goal_savings_entries where auth0_sub=new.auth0_sub and currency=new.currency and goal_id is not distinct from g.id and legacy_goal_ref is null)<0 then raise exception 'Insufficient savings destination balance'; end if;
 return new;
end $$;
create trigger goal_savings_posting after insert on public.ledger_entries for each row execute function private.record_goal_savings();

create or replace view public.savings_destination_balances with (security_invoker=true) as
select w.auth0_sub,w.currency,null::text as goal_id,coalesce((select sum(e.amount_minor) from public.goal_savings_entries e
 where e.auth0_sub=w.auth0_sub and e.currency=w.currency and e.goal_id is null and e.legacy_goal_ref is null),0)::bigint as amount_minor
from public.wallets w union all
select auth0_sub,currency,coalesce(goal_id::text,legacy_goal_ref),sum(amount_minor)::bigint
from public.goal_savings_entries where goal_id is not null or legacy_goal_ref is not null group by 1,2,3;

create function private.circle_member(p_sub text,p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.circle_members where circle_id=p_id and auth0_sub=p_sub and active);
$$;
do $$ declare t text; begin
 foreach t in array array['savings_circles','circle_members','circle_invitations','circle_proposals','circle_votes','circle_entries','circle_activity','circle_operations','goal_savings_entries'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to service_role',t);
 end loop;
end $$;
create policy circle_member_read on public.savings_circles for select to authenticated using(private.circle_member((select private.auth0_subject()),id));
create policy own_goal_entries on public.goal_savings_entries for select to authenticated using(auth0_sub=(select private.auth0_subject()));
grant select on public.savings_circles,public.goal_savings_entries to authenticated;
grant execute on function private.circle_member(text,uuid) to authenticated;
revoke all on function private.circle_member(text,uuid) from public,anon;

create function private.circle_entry_balance() returns trigger language plpgsql security definer set search_path='' as $$
declare was_reached timestamptz; circle_name text;
begin
 select reached_at,name into was_reached,circle_name from public.savings_circles where id=new.circle_id;
 update public.savings_circles set balance_minor=balance_minor+new.amount_minor,
  reached_at=case when balance_minor+new.amount_minor>=target_minor then coalesce(reached_at,now()) else reached_at end where id=new.circle_id;
 update public.circle_members set outstanding_minor=outstanding_minor+new.amount_minor where id=new.member_id and circle_id=new.circle_id;
 if was_reached is null and exists(select 1 from public.savings_circles where id=new.circle_id and reached_at is not null) then
  perform 1 from public.account_state where auth0_sub in(select auth0_sub from public.circle_members where circle_id=new.circle_id and active) order by user_id for update;
  update public.account_state set state=jsonb_set(state,'{notices}',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'at',now(),'title','Circle goal reached','body',circle_name||' reached its target. Automatic contributions are paused. Open Savings Circles to review the next step.','read',false))||coalesce(state->'notices','[]')),version=version+1,updated_at=now()
   where auth0_sub in(select auth0_sub from public.circle_members where circle_id=new.circle_id and active);
 end if;
 return new;
end $$;
create trigger circle_entry_balance after insert on public.circle_entries for each row execute function private.circle_entry_balance();

create function private.destination_currency(p_sub text,p_kind text,p_id uuid) returns text language plpgsql stable set search_path='' as $$
declare c text;
begin
 if p_kind='goal' then
  select currency into c from public.savings_goals g where g.id=p_id and g.auth0_sub=p_sub and g.archived_at is null
   and g.target_minor>coalesce((select sum(e.amount_minor) from public.goal_savings_entries e where e.goal_id=g.id),0);
 elsif p_kind='circle' then
  select currency into c from public.savings_circles where id=p_id and not archived and reached_at is null and balance_minor<target_minor and private.circle_member(p_sub,p_id);
 end if;
 return c;
end $$;
create function public.walletwise_set_savings_destination(p_sub text,p_kind text,p_id uuid,p_enable boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c text; destination jsonb;
begin
 if p_kind='circle' then perform 1 from public.savings_circles where id=p_id for update; end if;
 perform 1 from public.wallets where auth0_sub=p_sub order by currency for update;
 c:=private.destination_currency(p_sub,p_kind,p_id);
 if c is null then raise exception 'Savings destination unavailable'; end if;
 destination:=jsonb_build_object('kind',p_kind,'id',p_id,'currency',c);
 update public.profiles set savings_enabled=p_enable,wallet_preferences=wallet_preferences||jsonb_build_object('savingsDestination',destination),updated_at=now() where auth0_sub=p_sub;
 update public.savings_rules set enabled=p_enable where auth0_sub=p_sub;
 return destination;
end $$;

-- Persisted server-issued quotes bind exact source/destination amounts to an
-- authenticated account. Clients cannot submit an arbitrary rate to a debit.
create table public.savings_quotes (
 id uuid primary key default gen_random_uuid(),auth0_sub text not null references public.profiles(auth0_sub),
 destination_kind text not null check(destination_kind in ('goal','circle')),destination_id uuid not null,
 source_currency text not null check(source_currency in ('ILS','USD','JOD')),source_minor bigint not null check(source_minor between 1 and 9007199254740991),
 target_currency text not null check(target_currency in ('ILS','USD','JOD')),target_minor bigint not null check(target_minor between 1 and 9007199254740991),
 rate_units bigint not null check(rate_units between 1 and 9007199254740991),source text not null,observed_at timestamptz not null,expires_at timestamptz not null,
 fee_minor bigint not null default 0 check(fee_minor=0),snapshot_id text not null,
 rounding_policy text not null default 'half-up to destination minor unit' check(rounding_policy='half-up to destination minor unit'),
 simulated boolean not null default true check(simulated),
 created_at timestamptz not null default now(),check(expires_at>created_at and expires_at<=created_at+interval '5 minutes')
);
alter table public.savings_quotes enable row level security;
revoke all on public.savings_quotes from public,anon,authenticated,service_role;
grant select,insert on public.savings_quotes to service_role;

create function private.checked_savings_quote(p_sub text,p_kind text,p_dest uuid,p_currency text,p_amount bigint,p_quote uuid)
returns public.savings_quotes language plpgsql stable set search_path='' as $$
declare q public.savings_quotes; c text; received numeric;
begin
 c:=private.destination_currency(p_sub,p_kind,p_dest);
 if c is null then raise exception 'Savings destination unavailable'; end if;
 select * into q from public.savings_quotes where id=p_quote and auth0_sub=p_sub;
 if q.id is null or q.expires_at<=now() or q.destination_kind<>p_kind or q.destination_id<>p_dest
  or q.source_currency<>p_currency or q.source_minor<>p_amount or q.target_currency<>c then raise exception 'Savings quote expired'; end if;
 received:=round(p_amount::numeric*q.rate_units*(case when c='JOD' then 1000 else 100 end)/(1000000::numeric*(case when p_currency='JOD' then 1000 else 100 end)));
 if received<>q.target_minor or (p_currency=c and (q.rate_units<>1000000 or q.target_minor<>p_amount)) then raise exception 'Savings quote invalid'; end if;
 return q;
end $$;
create function private.expire_circle_requests(p_id uuid) returns void language sql set search_path='' as $$
 update public.circle_proposals set status='Expired' where circle_id=p_id and expires_at<=now() and status in ('Pending','Approved','Failed');
$$;
create function private.require_circle_open(p_id uuid) returns void language plpgsql set search_path='' as $$
begin
 perform private.expire_circle_requests(p_id);
 if exists(select 1 from public.circle_proposals where circle_id=p_id and status in ('Pending','Approved','Executing','Failed')) then raise exception 'Circle funds are locked for a vote'; end if;
end $$;

-- Neutral transfers between historical unassigned savings and an explicit goal.
create function public.walletwise_assign_historical(p_sub text,p_key uuid,p_goal uuid,p_amount bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare g public.savings_goals; available bigint; prior public.transactions;
begin
 perform 1 from public.wallets where auth0_sub=p_sub order by currency for update;
 select * into prior from public.transactions where auth0_sub=p_sub and request_id=p_key;
 if found then
  if prior.request_fingerprint<>'assign:'||p_goal||':'||p_amount then raise exception 'Idempotency key reused with different request'; end if;
  return to_jsonb(prior);
 end if;
 select * into g from public.savings_goals where id=p_goal and auth0_sub=p_sub and archived_at is null;
 if g.id is null or p_amount is null or p_amount<=0 then raise exception 'Savings destination unavailable'; end if;
 if exists(select 1 from public.savings_reconciliation_issues where auth0_sub=p_sub and currency=g.currency) then raise exception 'Historical savings require reconciliation'; end if;
 select coalesce(sum(amount_minor),0) into available from public.goal_savings_entries where auth0_sub=p_sub and currency=g.currency and goal_id is null and legacy_goal_ref is null;
 if available<p_amount then raise exception 'Insufficient wallet balance'; end if;
 return public.walletwise_apply_transaction(p_sub,p_key,'assign:'||p_goal||':'||p_amount,'adjustment','Assign historical savings','Savings',
 jsonb_build_array(jsonb_build_object('currency',g.currency,'account','savings','amount_minor',-p_amount),jsonb_build_object('currency',g.currency,'account','savings','amount_minor',p_amount)),
 jsonb_build_object('goalId',g.id,'reassign',true,'assignmentAmount',p_amount));
end $$;

-- Replacing the former fallback prevents even old clients from creating new
-- unassigned round-ups. Explicit opt-out is an independent parameter.
create function public.walletwise_goal_purchase(p_sub text,p_key uuid,p_fingerprint text,p_currency text,p_amount bigint,p_description text,p_category text,p_quote uuid default null,p_skip boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles; r public.savings_rules; prior public.transactions; d jsonb; q public.savings_quotes;
 saved bigint:=0; entries jsonb; result jsonb; member uuid;
begin
 if p_currency not in ('ILS','USD','JOD') or p_amount is null or p_amount<=0 or p_amount>9007199254740991 then raise exception 'Amount is invalid'; end if;
 select wallet_preferences->'savingsDestination' into d from public.profiles where auth0_sub=p_sub;
 if d->>'kind'='circle' then perform 1 from public.savings_circles where id=(d->>'id')::uuid for update; end if;
 perform 1 from public.wallets where auth0_sub=p_sub order by currency for update;
 select * into prior from public.transactions where auth0_sub=p_sub and request_id=p_key;
 if found then
  if prior.request_fingerprint<>p_fingerprint then raise exception 'Idempotency key reused with different request'; end if;
  return to_jsonb(prior);
 end if;
 select * into strict p from public.profiles where auth0_sub=p_sub for update;
 if d is distinct from p.wallet_preferences->'savingsDestination' then raise exception 'Savings destination changed'; end if;
 select * into strict r from public.savings_rules where auth0_sub=p_sub and currency=p_currency;
 if p.savings_enabled and r.enabled and not p_skip then saved:=least((r.increment_minor-p_amount%r.increment_minor)%r.increment_minor,r.cap_minor); end if;
 if saved>0 then
  if d is null then raise exception 'Choose a savings goal before saving'; end if;
  q:=private.checked_savings_quote(p_sub,d->>'kind',(d->>'id')::uuid,p_currency,saved,p_quote);
  if d->>'kind'='circle' then
   perform private.require_circle_open((d->>'id')::uuid);
   select id into strict member from public.circle_members where circle_id=(d->>'id')::uuid and auth0_sub=p_sub and active;
  end if;
 end if;
 entries:=jsonb_build_array(jsonb_build_object('currency',p_currency,'account','available','amount_minor',-p_amount-saved),
  jsonb_build_object('currency',p_currency,'account','external','amount_minor',p_amount+saved));
 if saved>0 and d->>'kind'='goal' then
  entries:=entries||jsonb_build_array(jsonb_build_object('currency',q.target_currency,'account','external','amount_minor',-q.target_minor),
    jsonb_build_object('currency',q.target_currency,'account','savings','amount_minor',q.target_minor));
 end if;
 result:=public.walletwise_apply_transaction(p_sub,p_key,p_fingerprint,'purchase',p_description,p_category,entries,
  jsonb_strip_nulls(jsonb_build_object('purchaseAmount',p_amount,'sourceSaving',saved,'skipSavings',p_skip,
   'goalId',case when saved>0 and d->>'kind'='goal' then d->>'id' end,'circleId',case when saved>0 and d->>'kind'='circle' then d->>'id' end,
   'saving',case when saved>0 then to_jsonb(q) - array['auth0_sub','created_at'] end)));
 if saved>0 and d->>'kind'='circle' then
  insert into public.circle_entries(circle_id,member_id,transaction_id,amount_minor,kind) values((d->>'id')::uuid,member,(result->>'id')::uuid,q.target_minor,'contribution');
 end if;
 return result;
end $$;
create or replace function public.walletwise_purchase(p_sub text,p_key uuid,p_fingerprint text,p_currency text,p_amount bigint,p_description text,p_category text)
returns jsonb language sql security definer set search_path='' as $$
 select public.walletwise_goal_purchase(p_sub,p_key,p_fingerprint,p_currency,p_amount,p_description,p_category);
$$;

create function public.walletwise_circle_contribute(p_sub text,p_id uuid,p_key uuid,p_fingerprint text,p_currency text,p_amount bigint,p_quote uuid,p_source_goal uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.savings_quotes; m public.circle_members; prior public.transactions; result jsonb; source_account text; available bigint;
begin
 perform 1 from public.savings_circles where id=p_id for update;
 if not private.circle_member(p_sub,p_id) then raise exception 'Circle access denied'; end if;
 perform 1 from public.wallets where auth0_sub=p_sub order by currency for update;
 select * into prior from public.transactions where auth0_sub=p_sub and request_id=p_key;
 if found then
  if prior.request_fingerprint<>p_fingerprint then raise exception 'Idempotency key reused with different request'; end if;
  return to_jsonb(prior);
 end if;
 perform private.require_circle_open(p_id);
 q:=private.checked_savings_quote(p_sub,'circle',p_id,p_currency,p_amount,p_quote);
 source_account:='available';
 if p_source_goal is not null then
  if not exists(select 1 from public.savings_goals where id=p_source_goal and auth0_sub=p_sub and currency=p_currency) then raise exception 'Savings destination unavailable'; end if;
  select coalesce(sum(amount_minor),0) into available from public.goal_savings_entries where auth0_sub=p_sub and goal_id=p_source_goal and currency=p_currency;
  if available<p_amount then raise exception 'Insufficient wallet balance'; end if;
  source_account:='savings';
 end if;
 result:=public.walletwise_apply_transaction(p_sub,p_key,p_fingerprint,'adjustment','Circle contribution','Savings Circle',
  jsonb_build_array(jsonb_build_object('currency',p_currency,'account',source_account,'amount_minor',-p_amount),jsonb_build_object('currency',p_currency,'account','external','amount_minor',p_amount)),
  jsonb_strip_nulls(jsonb_build_object('circleId',p_id,'sourceGoal',p_source_goal,'saving',to_jsonb(q)-array['auth0_sub','created_at'])));
 select * into strict m from public.circle_members where circle_id=p_id and auth0_sub=p_sub and active;
 insert into public.circle_entries(circle_id,member_id,transaction_id,amount_minor,kind) values(p_id,m.id,(result->>'id')::uuid,q.target_minor,'contribution');
 return result;
end $$;

create function public.walletwise_invitation_preview(p_hash text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('name',c.name,'description',c.description,'currency',c.currency,'target',c.target_minor::text,'expiresAt',i.expires_at)
 from public.circle_invitations i join public.savings_circles c on c.id=i.circle_id
 where i.token_hash=p_hash and i.revoked_at is null and i.expires_at>now() and not c.archived;
$$;

create function public.walletwise_circle_command(p_sub text,p_action text,p_id uuid,p_key uuid,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.savings_circles; m public.circle_members; proposal public.circle_proposals; invitation public.circle_invitations;
 prior public.circle_operations; result jsonb; fp text; recipient public.circle_members; tx jsonb; row record;
 amount bigint; allocated bigint:=0; share bigint; remainder bigint; total bigint;
begin
 fp:=p_action||coalesce(p_id::text,'')||p_payload::text;
 if p_action='join' then
  select * into invitation from public.circle_invitations where token_hash=p_payload->>'hash';
  p_id:=invitation.circle_id;
 end if;
 if p_id is not null then select * into c from public.savings_circles where id=p_id for update; end if;
 select * into prior from public.circle_operations where auth0_sub=p_sub and request_id=p_key;
 if found then
  if prior.fingerprint<>fp then raise exception 'Idempotency key reused with different request'; end if;
  return prior.result;
 end if;
 if p_action='create' then
  insert into public.savings_circles(owner_sub,name,description,currency,target_minor,target_date,icon)
   values(p_sub,p_payload->>'name',coalesce(p_payload->>'description',''),p_payload->>'currency',(p_payload->>'target')::bigint,(p_payload->>'targetDate')::date,coalesce(p_payload->>'icon','users')) returning * into c;
  insert into public.circle_members(circle_id,auth0_sub,display_name) select c.id,p_sub,coalesce(full_name,'Member') from public.profiles where auth0_sub=p_sub returning * into m;
 elsif p_action='join' then
  select * into invitation from public.circle_invitations where id=invitation.id for update;
  if c.id is null or c.archived or invitation.revoked_at is not null or invitation.expires_at<=now() then raise exception 'Invitation unavailable'; end if;
  insert into public.circle_members(circle_id,auth0_sub,display_name) select c.id,p_sub,coalesce(full_name,'Member') from public.profiles where auth0_sub=p_sub
   on conflict(circle_id,auth0_sub) do update set active=true returning * into m;
 else
  select * into m from public.circle_members where circle_id=c.id and auth0_sub=p_sub and active;
  if m.id is null then raise exception 'Circle access denied'; end if;
  perform private.expire_circle_requests(c.id);
  if p_action in ('invite','revoke','propose','cancel','execute','archive') and c.owner_sub<>p_sub then raise exception 'Only the circle owner may do this'; end if;
  if c.archived and p_action<>'leave' then raise exception 'Circle is archived'; end if;
  case p_action
  when 'invite' then
   update public.circle_invitations set revoked_at=now() where circle_id=c.id and revoked_at is null;
   insert into public.circle_invitations(circle_id,token_hash,expires_at) values(c.id,p_payload->>'hash',now()+interval '7 days');
  when 'revoke' then update public.circle_invitations set revoked_at=now() where circle_id=c.id and revoked_at is null;
  when 'leave' then
   if m.outstanding_minor<>0 or c.owner_sub=p_sub or exists(select 1 from public.circle_votes v join public.circle_proposals r on r.id=v.proposal_id where v.member_id=m.id and r.status in ('Pending','Approved','Failed')) then raise exception 'Request an approved return before leaving'; end if;
   update public.circle_members set active=false where id=m.id;
  when 'request_return' then
   if m.outstanding_minor<=0 then raise exception 'No outstanding contribution'; end if;
  when 'archive' then
   perform private.require_circle_open(c.id);
   if c.balance_minor<>0 then raise exception 'Return or withdraw circle funds before archiving'; end if;
   update public.savings_circles set archived=true where id=c.id;
   update public.circle_invitations set revoked_at=now() where circle_id=c.id and revoked_at is null;
  when 'propose' then
   perform private.require_circle_open(c.id);
   if p_payload->>'currency' is distinct from c.currency then raise exception 'Invalid proposal currency'; end if;
   amount:=(p_payload->>'amount')::bigint;
   if c.balance_minor<=0 then raise exception 'No outstanding contribution'; end if;
   if p_payload->>'kind' not in ('withdraw','target','return_all','return_member','owner') then raise exception 'Invalid proposal'; end if;
   select * into recipient from public.circle_members where id=(p_payload->>'destination')::uuid and circle_id=c.id and active;
   if p_payload->>'kind' in ('withdraw','return_member','owner') and recipient.id is null then raise exception 'Invalid proposal destination'; end if;
   if p_payload->>'kind'='target' and amount<=c.target_minor then raise exception 'New target must be higher'; end if;
   if p_payload->>'kind'='return_all' then amount:=c.balance_minor; end if;
   if p_payload->>'kind'='return_member' then amount:=recipient.outstanding_minor; end if;
   if p_payload->>'kind'='owner' then amount:=0; end if;
   if amount is null or amount<0 or (p_payload->>'kind'<>'owner' and amount=0) or (p_payload->>'kind' in ('withdraw','return_all','return_member') and amount>c.balance_minor) then raise exception 'Insufficient circle balance'; end if;
   insert into public.circle_proposals(circle_id,kind,amount_minor,destination_member,reason,currency,snapshot_total)
    values(c.id,p_payload->>'kind',amount,recipient.id,p_payload->>'reason',c.currency,c.balance_minor) returning * into proposal;
   insert into public.circle_votes(proposal_id,member_id,share_minor) select proposal.id,id,outstanding_minor from public.circle_members where circle_id=c.id and outstanding_minor>0;
   perform 1 from public.account_state where auth0_sub in(select cm.auth0_sub from public.circle_votes v join public.circle_members cm on cm.id=v.member_id where v.proposal_id=proposal.id) order by user_id for update;
   update public.account_state set state=jsonb_set(state,'{notices}',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'at',now(),'title','Circle vote requested','body',c.name||': '||proposal.kind||' — '||round(proposal.amount_minor::numeric/(case when c.currency='JOD' then 1000 else 100 end),case when c.currency='JOD' then 3 else 2 end)::text||' '||c.currency||'. Open Savings Circles to review the exact destination, reason and fees before voting.','read',false))||coalesce(state->'notices','[]')),version=version+1,updated_at=now()
    where auth0_sub in(select cm.auth0_sub from public.circle_votes v join public.circle_members cm on cm.id=v.member_id where v.proposal_id=proposal.id);
  when 'vote' then
   select * into proposal from public.circle_proposals where id=(p_payload->>'proposalId')::uuid and circle_id=c.id for update;
   if proposal.status<>'Pending' or proposal.expires_at<=now() or p_payload->>'decision' not in ('Approve','Reject') then raise exception 'Voting is closed'; end if;
   update public.circle_votes set decision=p_payload->>'decision',voted_at=now() where proposal_id=proposal.id and member_id=m.id and decision is null;
   if not found then raise exception 'You cannot vote on this request'; end if;
   if p_payload->>'decision'='Reject' then update public.circle_proposals set status='Rejected' where id=proposal.id;
   elsif not exists(select 1 from public.circle_votes where proposal_id=proposal.id and decision is distinct from 'Approve') then update public.circle_proposals set status='Approved' where id=proposal.id; end if;
  when 'cancel' then
   update public.circle_proposals set status='Canceled' where id=(p_payload->>'proposalId')::uuid and circle_id=c.id and status in ('Pending','Approved','Failed');
   if not found then raise exception 'Request cannot be canceled'; end if;
  when 'execute' then
   select * into proposal from public.circle_proposals where id=(p_payload->>'proposalId')::uuid and circle_id=c.id for update;
   if proposal.id is null then raise exception 'Request unavailable'; end if;
   if proposal.status='Completed' then return jsonb_build_object('id',c.id,'status','Completed'); end if;
   if proposal.status not in ('Approved','Failed') or proposal.expires_at<=now() or not exists(select 1 from public.circle_votes where proposal_id=proposal.id)
    or exists(select 1 from public.circle_votes where proposal_id=proposal.id and decision is distinct from 'Approve') then raise exception 'Unanimous approval is required'; end if;
   begin
    update public.circle_proposals set status='Executing' where id=proposal.id;
    if proposal.kind='target' then update public.savings_circles set target_minor=proposal.amount_minor,reached_at=case when balance_minor>=proposal.amount_minor then coalesce(reached_at,now()) else null end where id=c.id;
    elsif proposal.kind='owner' then
     select * into strict recipient from public.circle_members where id=proposal.destination_member and circle_id=c.id and active;
     update public.savings_circles set owner_sub=recipient.auth0_sub where id=c.id;
    else
     if proposal.snapshot_total<>c.balance_minor or proposal.amount_minor>c.balance_minor then raise exception 'Circle balance changed'; end if;
     perform 1 from public.wallets where auth0_sub in (select auth0_sub from public.circle_members where circle_id=c.id) order by auth0_sub,currency for update;
     select * into recipient from public.circle_members where id=proposal.destination_member and circle_id=c.id;
     if proposal.kind='withdraw' then
      tx:=public.walletwise_apply_transaction(recipient.auth0_sub,gen_random_uuid(),'circle-withdraw:'||proposal.id,'adjustment','Approved circle withdrawal','Savings Circle',
       jsonb_build_array(jsonb_build_object('currency',c.currency,'account','available','amount_minor',proposal.amount_minor),jsonb_build_object('currency',c.currency,'account','external','amount_minor',-proposal.amount_minor)),jsonb_build_object('circleId',c.id,'proposalId',proposal.id));
     end if;
     remainder:=proposal.amount_minor-(select coalesce(sum(floor(proposal.amount_minor::numeric*share_minor/proposal.snapshot_total)),0) from public.circle_votes where proposal_id=proposal.id);
     for row in select v.member_id,v.share_minor,cm.auth0_sub from public.circle_votes v join public.circle_members cm on cm.id=v.member_id where v.proposal_id=proposal.id order by v.member_id loop
      if proposal.kind='return_all' then share:=row.share_minor;
      elsif proposal.kind='return_member' then share:=case when row.member_id=proposal.destination_member then proposal.amount_minor else 0 end;
      else
       share:=floor(proposal.amount_minor::numeric*row.share_minor/proposal.snapshot_total);
       if remainder>0 then share:=share+1;remainder:=remainder-1; end if;
      end if;
      if share>0 then
       if proposal.kind<>'withdraw' then
        tx:=public.walletwise_apply_transaction(row.auth0_sub,gen_random_uuid(),'circle-return:'||proposal.id||':'||row.member_id,'adjustment','Approved circle return','Savings Circle',
         jsonb_build_array(jsonb_build_object('currency',c.currency,'account','available','amount_minor',share),jsonb_build_object('currency',c.currency,'account','external','amount_minor',-share)),jsonb_build_object('circleId',c.id,'proposalId',proposal.id));
       end if;
       insert into public.circle_entries(circle_id,member_id,transaction_id,proposal_id,amount_minor,kind) values(c.id,row.member_id,(tx->>'id')::uuid,proposal.id,-share,'distribution');
      end if;
     end loop;
    end if;
    update public.circle_proposals set status='Completed',completed_at=now(),error=null where id=proposal.id;
   exception when others then
    update public.circle_proposals set status='Failed',error='Transfer failed. Funds remain locked; retry or cancel.' where id=proposal.id;
   end;
  else raise exception 'Invalid circle operation';
  end case;
 end if;
 insert into public.circle_activity(circle_id,member_id,event,details) values(c.id,m.id,p_action,p_payload-array['hash']);
 result:=jsonb_build_object('id',c.id,'proposalId',proposal.id,'status',(select status from public.circle_proposals where id=proposal.id));
 insert into public.circle_operations values(p_sub,p_key,fp,result);
 return result;
end $$;

create function public.walletwise_circles(p_sub text,p_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.savings_circles; result jsonb;
begin
 if p_id is null then
  return (select coalesce(jsonb_agg(jsonb_build_object('id',listed.id,'name',listed.name,'description',listed.description,'currency',listed.currency,'target',listed.target_minor::text,'balance',listed.balance_minor::text,'owner',listed.owner_sub=p_sub,'archived',listed.archived,'reached',listed.reached_at is not null,'icon',listed.icon) order by listed.created_at),'[]') from public.savings_circles listed where private.circle_member(p_sub,listed.id));
 end if;
 if not private.circle_member(p_sub,p_id) then raise exception 'Circle access denied'; end if;
 select * into strict c from public.savings_circles where id=p_id;
 return jsonb_build_object('id',c.id,'name',c.name,'description',c.description,'currency',c.currency,'target',c.target_minor::text,'balance',c.balance_minor::text,'owner',c.owner_sub=p_sub,'archived',c.archived,'reached',c.reached_at is not null,'targetDate',c.target_date,
 'members',(select jsonb_agg(jsonb_build_object('id',id,'name',display_name,'share',outstanding_minor::text,'active',active,'you',auth0_sub=p_sub,'owner',auth0_sub=c.owner_sub) order by joined_at) from public.circle_members where circle_id=p_id),
 'entries',(select coalesce(jsonb_agg(x),'[]') from(select e.id,e.member_id as "memberId",e.amount_minor::text as amount,e.kind,e.created_at as at from public.circle_entries e where e.circle_id=p_id order by e.created_at desc limit 50)x),
 'activity',(select coalesce(jsonb_agg(x),'[]') from(select event,member_id as "memberId",details,created_at as at from public.circle_activity where circle_id=p_id order by created_at desc limit 50)x),
 'proposals',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'kind',r.kind,'amount',r.amount_minor::text,'currency',r.currency,'fee',r.fee_minor::text,'reason',r.reason,'destination',r.destination_member,'expiresAt',r.expires_at,'remaining',(r.snapshot_total-case when r.kind in ('withdraw','return_all','return_member') then r.amount_minor else 0 end)::text,'status',case when r.expires_at<=now() and r.status in ('Pending','Approved','Failed') then 'Expired' else r.status end,'error',r.error,
 'votes',(select jsonb_agg(jsonb_build_object('memberId',v.member_id,'decision',v.decision,'share',v.share_minor::text)) from public.circle_votes v where v.proposal_id=r.id)) order by r.created_at desc),'[]') from public.circle_proposals r where r.circle_id=p_id));
end $$;

-- Guard activation, even through older Settings clients. No destination is
-- manufactured, and the old per-currency default map is no longer a fallback.
alter function public.walletwise_patch_preferences(text,jsonb) rename to walletwise_patch_preferences_before_circles;
revoke all on function public.walletwise_patch_preferences_before_circles(text,jsonb) from public,anon,authenticated,service_role;
create function public.walletwise_patch_preferences(p_auth0_sub text,p_patch jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb;
begin
 if p_patch ? 'savingsDestination' or p_patch ? 'goalIds' then raise exception 'Choose a savings goal using savings setup'; end if;
 if p_patch->>'savings'='enabled' then
  select wallet_preferences->'savingsDestination' into d from public.profiles where auth0_sub=p_auth0_sub;
  if private.destination_currency(p_auth0_sub,d->>'kind',(d->>'id')::uuid) is null then raise exception 'Choose a savings goal before saving'; end if;
 end if;
 return public.walletwise_patch_preferences_before_circles(p_auth0_sub,p_patch);
end $$;

-- Keep new functions inaccessible to anonymous/browser database callers.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='public' and p.proname in ('walletwise_set_savings_destination','walletwise_assign_historical','walletwise_goal_purchase','walletwise_circle_contribute','walletwise_invitation_preview','walletwise_circle_command','walletwise_circles','walletwise_patch_preferences'))
    or (n.nspname='private' and p.proname in ('record_goal_savings','circle_entry_balance','destination_currency','checked_savings_quote','expire_circle_requests','require_circle_open')) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.signature::text like 'walletwise_%' or f.signature::text like 'public.walletwise_%' then execute format('grant execute on function %s to service_role',f.signature); end if;
 end loop;
end $$;
notify pgrst, 'reload schema';

create function public.walletwise_savings_options(p_sub text) returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('destination',(select wallet_preferences->'savingsDestination' from public.profiles where auth0_sub=p_sub),
 'options',(select coalesce(jsonb_agg(x),'[]') from (
  select g.id,'goal'::text as kind,g.name,g.currency,g.target_minor::text as target,coalesce((select sum(amount_minor) from public.goal_savings_entries where goal_id=g.id),0)::text as saved
  from public.savings_goals g where g.auth0_sub=p_sub and private.destination_currency(p_sub,'goal',g.id) is not null
  union all select c.id,'circle',c.name,c.currency,c.target_minor::text,c.balance_minor::text from public.savings_circles c where private.destination_currency(p_sub,'circle',c.id) is not null)x),
 'historical',(select coalesce(jsonb_object_agg(currency,amount_minor::text),'{}') from public.savings_destination_balances where auth0_sub=p_sub and goal_id is null),
 'reconciliationRequired',exists(select 1 from public.savings_reconciliation_issues where auth0_sub=p_sub));
$$;
create function public.walletwise_goal_refund(p_sub text,p_key uuid,p_original uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare original public.transactions; prior public.transactions; result jsonb; entries jsonb;
begin
 select * into original from public.transactions where id=p_original and auth0_sub=p_sub and kind='purchase';
 if original.id is null then raise exception 'Purchase not found'; end if;
 perform 1 from public.wallets where auth0_sub=p_sub order by currency for update;
 select * into prior from public.transactions where auth0_sub=p_sub and request_id=p_key;
 if found then
  if prior.request_fingerprint<>'refund:'||p_original then raise exception 'Idempotency key reused with different request'; end if;
  return to_jsonb(prior);
 end if;
 if exists(select 1 from public.transactions where auth0_sub=p_sub and metadata->>'originalId'=p_original::text and (kind='refund' or metadata->>'merchantRefund'='true')) then raise exception 'Purchase already refunded'; end if;
 if original.metadata->>'circleId' is not null then
  -- Refund only the merchant debit. A private purchase refund must NEVER be
  -- a unilateral withdrawal of locked shared savings. The original Circle
  -- contribution remains intact and returns only via a unanimous proposal.
  return public.walletwise_apply_transaction(p_sub,p_key,'refund:'||p_original,'adjustment','Refund: '||original.description,original.category,
   jsonb_build_array(jsonb_build_object('currency',original.metadata->'saving'->>'source_currency','account','available','amount_minor',(original.metadata->>'purchaseAmount')::bigint),
   jsonb_build_object('currency',original.metadata->'saving'->>'source_currency','account','external','amount_minor',-(original.metadata->>'purchaseAmount')::bigint)),
   jsonb_build_object('originalId',p_original,'merchantRefund',true,'savingsRetained',true,'sourceSaving',0,'circleId',original.metadata->>'circleId'));
 end if;
 select jsonb_agg(jsonb_build_object('currency',currency,'account',account,'amount_minor',-amount_minor)) into entries from public.ledger_entries where transaction_id=p_original and auth0_sub=p_sub;
 result:=public.walletwise_apply_transaction(p_sub,p_key,'refund:'||p_original,'refund','Refund: '||original.description,original.category,entries,
  original.metadata||jsonb_build_object('originalId',p_original));
 return result;
end $$;
revoke all on function public.walletwise_savings_options(text),public.walletwise_goal_refund(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.walletwise_savings_options(text),public.walletwise_goal_refund(text,uuid,uuid) to service_role;

create function public.walletwise_own_circle_ledger(p_sub text) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('currency',c.currency,'amount',e.amount_minor::text,'at',e.created_at,'circleId',c.id) order by e.created_at,e.id),'[]')
 from public.circle_entries e join public.circle_members m on m.id=e.member_id join public.savings_circles c on c.id=e.circle_id where m.auth0_sub=p_sub;
$$;
revoke all on function public.walletwise_own_circle_ledger(text) from public,anon,authenticated;
grant execute on function public.walletwise_own_circle_ledger(text) to service_role;
alter function public.walletwise_dashboard(text,text,text) rename to walletwise_dashboard_before_circles;
revoke all on function public.walletwise_dashboard_before_circles(text,text,text) from public,anon,authenticated,service_role;
create function public.walletwise_dashboard(p_sub text,p_uid text,p_timezone text default 'UTC') returns jsonb language sql stable security definer set search_path='' as $$
 select case when d is null then null else jsonb_set(d,'{dashboard}',(d->'dashboard')||jsonb_build_object('circleSavings',
 (select jsonb_object_agg(currency,amount::text) from(select v.currency,coalesce(sum(m.outstanding_minor),0) as amount from (values('ILS'),('USD'),('JOD'))v(currency)
 left join public.savings_circles c on c.currency=v.currency left join public.circle_members m on m.circle_id=c.id and m.auth0_sub=p_sub group by v.currency)x)))end
 from public.walletwise_dashboard_before_circles(p_sub,p_uid,p_timezone)d;
$$;
revoke all on function public.walletwise_dashboard(text,text,text) from public,anon,authenticated;
grant execute on function public.walletwise_dashboard(text,text,text) to service_role;

create or replace function public.walletwise_create_savings_goal(p_sub text,p_uid text,p_key uuid,p_fingerprint text,p_goal jsonb,p_default boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.account_state; prior jsonb; g public.savings_goals; result jsonb;
begin
 perform public.walletwise_initialize_user(p_sub);
 perform 1 from public.wallets where auth0_sub=p_sub order by currency for update;
 select * into strict a from public.account_state where auth0_sub=p_sub and user_id=p_uid for update;
 prior:=a.state->'operations'->p_key::text;
 if prior is not null then
   if prior->>'fingerprint'<>p_fingerprint then raise exception 'Idempotency key reused with different request'; end if;
   return prior->'result';
 end if;
 if (select count(*) from public.savings_goals where auth0_sub=p_sub and archived_at is null)>=25 then raise exception 'Maximum 25 goals'; end if;
 insert into public.savings_goals(auth0_sub,currency,name,target_minor,target_date)
 values(p_sub,p_goal->>'currency',p_goal->>'name',(p_goal->>'target')::bigint,(p_goal->>'targetDate')::date) returning * into g;
 result:=jsonb_strip_nulls(jsonb_build_object('id',g.id,'currency',g.currency,'name',g.name,'target',g.target_minor,'targetDate',g.target_date,'createdAt',g.created_at));
 update public.account_state set state=jsonb_set(jsonb_set(state,'{goals}',coalesce(state->'goals','[]')||jsonb_build_array(result)),
   '{operations}',coalesce(state->'operations','{}')||jsonb_build_object(p_key::text,jsonb_build_object('fingerprint',p_fingerprint,'result',result))),version=version+1,updated_at=now()
 where user_id=p_uid and auth0_sub=p_sub;
 if p_default then perform public.walletwise_set_savings_destination(p_sub,'goal',g.id,true); end if;
 return result;
end $$;

create or replace function public.walletwise_archive_savings_goal(p_sub text,p_uid text,p_goal uuid)
returns void language plpgsql security definer set search_path='' as $$
declare g public.savings_goals;
begin
 perform 1 from public.wallets where auth0_sub=p_sub order by currency for update;
 perform 1 from public.account_state where auth0_sub=p_sub and user_id=p_uid for update;
 if not found then raise exception 'Select an owned goal'; end if;
 update public.savings_goals set archived_at=coalesce(archived_at,now()) where id=p_goal and auth0_sub=p_sub returning * into g;
 if not found then raise exception 'Select an owned goal'; end if;
 update public.profiles set savings_enabled=false,wallet_preferences=jsonb_set(wallet_preferences,'{savingsDestination}','null')
 where auth0_sub=p_sub and wallet_preferences->'savingsDestination'->>'id'=p_goal::text;
 update public.account_state set state=jsonb_set(state,'{goals}',
   (select coalesce(jsonb_agg(case when x->>'id'=p_goal::text then x||'{"archived":true}'::jsonb else x end),'[]') from jsonb_array_elements(state->'goals') x)),
   version=version+1,updated_at=now() where auth0_sub=p_sub and user_id=p_uid;
end $$;



-- Migration: 202611010001_circle_invitation_membership.sql
-- Private membership-aware invitation reads; public previews remain unchanged.
create function public.walletwise_invitation_status(p_sub text, p_hash text)
returns jsonb language sql stable security definer set search_path='' as $$
 select public.walletwise_invitation_preview(p_hash) || jsonb_build_object(
  'alreadyMember', exists(select 1 from public.circle_members m
    where m.circle_id=i.circle_id and m.auth0_sub=p_sub and m.active),
  'circleId', case when exists(select 1 from public.circle_members m
    where m.circle_id=i.circle_id and m.auth0_sub=p_sub and m.active)
    then i.circle_id else null end)
 from public.circle_invitations i join public.savings_circles c on c.id=i.circle_id
 where i.token_hash=p_hash and i.revoked_at is null and i.expires_at>now() and not c.archived;
$$;

-- Lock the same Circle row as the command function before testing membership.
-- Repeated clicks/tabs return membership without writing another join event.
create function public.walletwise_join_circle(p_sub text, p_hash text, p_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare circle_id uuid; status jsonb;
begin
 select i.circle_id into circle_id from public.circle_invitations i where i.token_hash=p_hash;
 if circle_id is null then raise exception 'Invitation unavailable'; end if;
 perform 1 from public.savings_circles c where c.id=circle_id for update;
 status:=public.walletwise_invitation_status(p_sub,p_hash);
 if status is null then raise exception 'Invitation unavailable'; end if;
 if (status->>'alreadyMember')::boolean then
  return jsonb_build_object('id',circle_id,'alreadyMember',true);
 end if;
 return public.walletwise_circle_command(p_sub,'join',null,p_key,jsonb_build_object('hash',p_hash))
  || jsonb_build_object('alreadyMember',false);
end $$;

revoke all on function public.walletwise_invitation_status(text,text) from public,anon,authenticated;
revoke all on function public.walletwise_join_circle(text,text,uuid) from public,anon,authenticated;
grant execute on function public.walletwise_invitation_status(text,text) to service_role;
grant execute on function public.walletwise_join_circle(text,text,uuid) to service_role;
notify pgrst, 'reload schema';

NOTIFY pgrst, 'reload schema';
COMMIT;
