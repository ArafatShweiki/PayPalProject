-- Internal shared infrastructure only. Existing financial tables/functions are unchanged.
-- All API entry points are service-only and use database time and transaction locks.
BEGIN;
create sequence private.backend_record_version;
create table private.backend_records (
 id text primary key check (length(id) between 1 and 256),
 value jsonb not null check (octet_length(value::text) <= 4000000),
 version bigint not null default nextval('private.backend_record_version'),
 expires_at timestamptz,
 updated_at timestamptz not null default clock_timestamp()
);
create index backend_records_expiry on private.backend_records(expires_at) where expires_at is not null;
create table private.backend_limits (
 scope text not null check(length(scope) between 1 and 256),
 identity_hash text not null check(length(identity_hash)=64),
 count integer not null check(count>=0),
 expires_at timestamptz not null,
 primary key(scope,identity_hash)
);
create index backend_limits_expiry on private.backend_limits(expires_at);
create table private.backend_lease_scopes (
 scope text primary key check(length(scope) between 1 and 256),
 generation bigint not null default 0
);
create table private.backend_leases (
 scope text not null references private.backend_lease_scopes(scope),
 owner uuid not null,
 generation bigint not null,
 expires_at timestamptz not null,
 primary key(scope,owner)
);
create index backend_leases_expiry on private.backend_leases(expires_at);
alter table private.backend_records enable row level security;
alter table private.backend_limits enable row level security;
alter table private.backend_lease_scopes enable row level security;
alter table private.backend_leases enable row level security;
revoke all on private.backend_records,private.backend_limits,private.backend_lease_scopes,private.backend_leases from public,anon,authenticated,service_role;
revoke all on sequence private.backend_record_version from public,anon,authenticated,service_role;

create function private.walletwise_check_backend_guards(p_guards jsonb) returns void
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare g jsonb;
begin
 if p_guards is null or jsonb_typeof(p_guards) <> 'array' or jsonb_array_length(p_guards)>8 then raise exception 'Invalid lease guards'; end if;
 for g in select value from jsonb_array_elements(p_guards) order by value->>'scope' loop
  -- Scope share lock serializes publication with ownership changes/release.
  perform 1 from private.backend_lease_scopes where scope=g->>'scope' for share;
  perform 1 from private.backend_leases where scope=g->>'scope' and owner=(g->>'owner')::uuid
   and generation=(g->>'generation')::bigint and expires_at>clock_timestamp() for share;
  if not found then raise exception 'Backend lease expired' using errcode='55000'; end if;
 end loop;
end $$;
revoke all on function private.walletwise_check_backend_guards(jsonb) from public,anon,authenticated,service_role;

create function public.walletwise_backend_read(p_id text) returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('version',version,'value',case when expires_at is null or expires_at>clock_timestamp() then value else null end)
 from private.backend_records where id=p_id;
$$;
create function public.walletwise_backend_cas(p_id text,p_version bigint,p_value jsonb,p_expires_at timestamptz default null,p_guards jsonb default '[]') returns boolean
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
begin
 perform private.walletwise_check_backend_guards(p_guards);
 if p_value is null then raise exception 'Missing backend value'; end if;
 if p_version is null then
  insert into private.backend_records(id,value,expires_at) values(p_id,p_value,p_expires_at) on conflict do nothing;
 else
  update private.backend_records set value=p_value,version=nextval('private.backend_record_version'),expires_at=p_expires_at,updated_at=clock_timestamp()
   where id=p_id and version=p_version;
 end if;
 return found;
end $$;

create function public.walletwise_consume_limit(p_scope text,p_identity text,p_limit integer,p_window_ms integer) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare r private.backend_limits; t timestamptz;
begin
 if p_limit is null or p_limit<1 or p_limit>10000000 or p_window_ms is null or p_window_ms<1 or p_window_ms>86400000 then raise exception 'Invalid limit'; end if;
 -- Bounded opportunistic cleanup supplements the daily cron under traffic.
 if random()<0.02 then perform public.walletwise_cleanup_backend(200); end if;
 insert into private.backend_limits(scope,identity_hash,count,expires_at) values(p_scope,p_identity,0,clock_timestamp()) on conflict do nothing;
 select * into r from private.backend_limits where scope=p_scope and identity_hash=p_identity for update;
 t:=clock_timestamp();
 if r.expires_at<=t then r.count:=0; r.expires_at:=t+make_interval(secs=>p_window_ms/1000.0); end if;
 if r.count<p_limit then
  update private.backend_limits set count=r.count+1,expires_at=r.expires_at where scope=p_scope and identity_hash=p_identity;
  return jsonb_build_object('allowed',true,'bucket',jsonb_build_object('count',r.count+1,'reset',floor(extract(epoch from r.expires_at)*1000)), 'retryAfter',greatest(1,ceil(extract(epoch from r.expires_at-t))));
 end if;
 return jsonb_build_object('allowed',false,'bucket',jsonb_build_object('count',r.count,'reset',floor(extract(epoch from r.expires_at)*1000)), 'retryAfter',greatest(1,ceil(extract(epoch from r.expires_at-t))));
end $$;

create function public.walletwise_backend_lease(p_action text,p_scope text,p_owner uuid,p_slots integer,p_duration_ms integer,p_generation bigint default null) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare n bigint; t timestamptz; r private.backend_leases;
begin
 if p_action is null or p_action not in ('acquire','renew','release') or p_owner is null or p_slots is null or p_slots<1 or p_slots>100 or p_duration_ms is null or p_duration_ms<1 or p_duration_ms>300000 then raise exception 'Invalid lease'; end if;
 insert into private.backend_lease_scopes(scope) values(p_scope) on conflict do nothing;
 perform 1 from private.backend_lease_scopes where scope=p_scope for update;
 t:=clock_timestamp();
 if p_action='release' then
  delete from private.backend_leases where scope=p_scope and owner=p_owner and generation=p_generation;
  return jsonb_build_object('acquired',false,'released',found);
 end if;
 if p_action='renew' then
  update private.backend_leases set expires_at=t+make_interval(secs=>p_duration_ms/1000.0)
   where scope=p_scope and owner=p_owner and generation=p_generation and expires_at>t returning * into r;
  if not found then return jsonb_build_object('acquired',false); end if;
 else
  delete from private.backend_leases where scope=p_scope and expires_at<=t;
  select * into r from private.backend_leases where scope=p_scope and owner=p_owner;
  if not found then
   select count(*) into n from private.backend_leases where scope=p_scope;
   if n>=p_slots then return jsonb_build_object('acquired',false); end if;
   update private.backend_lease_scopes set generation=nextval('private.backend_record_version') where scope=p_scope returning generation into n;
   insert into private.backend_leases(scope,owner,generation,expires_at) values(p_scope,p_owner,n,t+make_interval(secs=>p_duration_ms/1000.0)) returning * into r;
  end if;
 end if;
 return jsonb_build_object('acquired',true,'scope',r.scope,'owner',r.owner,'generation',r.generation,'expiresAt',r.expires_at);
end $$;

-- Reuse the established historical table. Previously all its rows were Twelve Data.
alter table public.forex_snapshots add column provider text not null default 'twelve' check(provider in ('pma','twelve'));
create index forex_snapshots_provider_time on public.forex_snapshots(provider,observed_at desc,fetched_at desc);
create or replace function public.forex_history(p_since timestamptz,p_bucket_seconds integer)
returns setof jsonb language sql stable security invoker set search_path='' as $$
 select snapshot from (
  select distinct on (floor(extract(epoch from observed_at)/greatest(p_bucket_seconds,60))) snapshot,observed_at
  from public.forex_snapshots where provider='twelve' and observed_at>=p_since
  order by floor(extract(epoch from observed_at)/greatest(p_bucket_seconds,60)),observed_at desc,fetched_at desc
 ) points order by observed_at asc limit 500;
$$;
create function public.walletwise_store_observation(p_provider text,p_snapshot jsonb,p_guards jsonb default '[]') returns boolean
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
begin
 perform private.walletwise_check_backend_guards(p_guards);
 if p_provider is null or p_provider not in ('pma','twelve') or p_snapshot is null or jsonb_typeof(p_snapshot)<>'object' or coalesce(length(p_snapshot->>'id'),0) not between 1 and 128
  or coalesce((p_snapshot#>>'{ils,ILS}')::bigint,0)<>1000000 or coalesce((p_snapshot#>>'{ils,USD}')::bigint,0)<=0 or coalesce((p_snapshot#>>'{ils,JOD}')::bigint,0)<=0
  or p_snapshot->>'source' is null or p_snapshot->>'fetchedAt' is null then raise exception 'Invalid observation'; end if;
 insert into public.forex_snapshots(id,observed_at,fetched_at,snapshot,provider)
 values(p_snapshot->>'id',coalesce(nullif(p_snapshot->>'publishedAt',''),p_snapshot->>'fetchedAt')::timestamptz,(p_snapshot->>'fetchedAt')::timestamptz,p_snapshot,p_provider)
 on conflict(id) do nothing;
 if not found and exists(select 1 from public.forex_snapshots where id=p_snapshot->>'id' and (provider<>p_provider or (snapshot-'fetchedAt')<>(p_snapshot-'fetchedAt'))) then raise exception 'Conflicting observation'; end if;
 return found;
end $$;

-- Fenced auxiliary account writes during alert jobs. Ledger RPCs are untouched.
create function public.walletwise_backend_account_cas(p_uid text,p_sub text,p_version bigint,p_state jsonb,p_guards jsonb) returns boolean
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
begin
 perform private.walletwise_check_backend_guards(p_guards);
 if p_version is null then
  insert into public.account_state(user_id,auth0_sub,state) values(p_uid,p_sub,p_state) on conflict do nothing;
 else
  update public.account_state set state=p_state,version=version+1,updated_at=clock_timestamp() where user_id=p_uid and auth0_sub=p_sub and version=p_version;
 end if;
 return found;
end $$;

create function public.walletwise_cleanup_backend(p_batch integer default 500) returns integer
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare n integer; total integer:=0; s text;
begin
 if p_batch is null or p_batch<1 or p_batch>1000 then raise exception 'Invalid cleanup batch'; end if;
 -- Never clean financial records, historical observations or persistent imported records.
 with dead as(select id from private.backend_records where expires_at<=clock_timestamp() order by expires_at limit p_batch for update skip locked)
 delete from private.backend_records where id in(select id from dead); get diagnostics n=row_count; total:=total+n;
 with dead as(select scope,identity_hash from private.backend_limits where expires_at<=clock_timestamp() order by expires_at limit p_batch for update skip locked)
 delete from private.backend_limits where (scope,identity_hash) in(select scope,identity_hash from dead); get diagnostics n=row_count; total:=total+n;
 -- Lock scopes before deleting lease rows, in the same order as acquisition.
 -- Globally monotonic generations prevent ABA even after scope cleanup/recreation.
 for s in select scope from private.backend_lease_scopes s where not exists(select 1 from private.backend_leases l where l.scope=s.scope and l.expires_at>clock_timestamp()) order by scope limit p_batch for update skip locked loop
  delete from private.backend_leases where scope=s and expires_at<=clock_timestamp();
  delete from private.backend_lease_scopes where scope=s and not exists(select 1 from private.backend_leases where scope=s);
  get diagnostics n=row_count; total:=total+n;
 end loop;
 return total;
end $$;

revoke all on function public.walletwise_backend_read(text),public.walletwise_backend_cas(text,bigint,jsonb,timestamptz,jsonb),public.walletwise_consume_limit(text,text,integer,integer),public.walletwise_backend_lease(text,text,uuid,integer,integer,bigint),public.walletwise_store_observation(text,jsonb,jsonb),public.walletwise_backend_account_cas(text,text,bigint,jsonb,jsonb),public.walletwise_cleanup_backend(integer) from public,anon,authenticated;
grant execute on function public.walletwise_backend_read(text),public.walletwise_backend_cas(text,bigint,jsonb,timestamptz,jsonb),public.walletwise_consume_limit(text,text,integer,integer),public.walletwise_backend_lease(text,text,uuid,integer,integer,bigint),public.walletwise_store_observation(text,jsonb,jsonb),public.walletwise_backend_account_cas(text,text,bigint,jsonb,jsonb),public.walletwise_cleanup_backend(integer) to service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
