-- Separate from legacy PMA records; preserves original exchange_rates and integration identifiers.
create table public.forex_snapshots (
 id text primary key,
 observed_at timestamptz not null,
 fetched_at timestamptz not null,
 snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object')
);
create index forex_snapshots_observed_idx on public.forex_snapshots(observed_at desc);
alter table public.forex_snapshots enable row level security;
revoke all on public.forex_snapshots from public,anon,authenticated,service_role;
grant select on public.forex_snapshots to authenticated;
create policy forex_read on public.forex_snapshots for select to authenticated using (true);
grant select,insert on public.forex_snapshots to service_role;
create function public.forex_history(p_since timestamptz,p_bucket_seconds integer)
returns setof jsonb language sql stable security invoker set search_path='' as $$
 select snapshot from (
  select distinct on (floor(extract(epoch from observed_at)/greatest(p_bucket_seconds,60))) snapshot, observed_at
  from public.forex_snapshots where observed_at >= p_since
  order by floor(extract(epoch from observed_at)/greatest(p_bucket_seconds,60)), observed_at desc, fetched_at desc
 ) points order by observed_at asc limit 500;
$$;
revoke all on function public.forex_history(timestamptz,integer) from public,anon,authenticated;
grant execute on function public.forex_history(timestamptz,integer) to service_role;
