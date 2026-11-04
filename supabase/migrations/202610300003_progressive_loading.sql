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
