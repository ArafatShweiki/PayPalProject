-- Depends on all preceding migrations. No hosted execution or balance backfill.
-- A single MVCC snapshot supplies the coach; private identities never leave this RPC.
create function public.walletwise_coach(p_sub text,p_uid text) returns jsonb
language sql stable security definer set search_path='' as $$
select jsonb_build_object(
 'asOf',now(),'goals',coalesce((select jsonb_agg(g.value||jsonb_build_object('saved',coalesce((select b.amount_minor from public.savings_destination_balances b where b.auth0_sub=p_sub and b.goal_id=g.value->>'id'),0))) from jsonb_array_elements(coalesce(a.state->'goals','[]'))g(value)),'[]'),
 'samples',coalesce((select jsonb_agg(jsonb_build_object('goalId',coalesce(e.goal_id::text,e.legacy_goal_ref),'at',t.occurred_at,'amount',e.amount_minor,
 'paceAmount',case when t.metadata ? 'reassign' or t.metadata ? 'assignmentAmount' then 0 else e.amount_minor end) order by t.occurred_at,l.id)
 from public.goal_savings_entries e join public.ledger_entries l on l.id=e.ledger_entry_id join public.transactions t on t.id=l.transaction_id
 where e.auth0_sub=p_sub and t.auth0_sub=p_sub and t.occurred_at>=now()-interval '56 days'),'[]'),
 'spending',coalesce((select jsonb_agg(jsonb_build_object('currency',currency,'category',category,'gross',gross,'refunds',refunds,'net',net,'previous',case when (a.state->>'createdAt')::timestamptz<=now()-interval '56 days' then previous else null end,'count',count)) from (
 select l.currency,coalesce(original.category,t.category) category,
 sum(case when t.occurred_at>=now()-interval '28 days' and t.kind='purchase' then l.amount_minor else 0 end) gross,
 -sum(case when t.occurred_at>=now()-interval '28 days' and t.kind<>'purchase' then l.amount_minor else 0 end) refunds,
 sum(case when t.occurred_at>=now()-interval '28 days' then l.amount_minor else 0 end) net,
 sum(case when t.occurred_at<now()-interval '28 days' then l.amount_minor else 0 end) previous,
 count(*) filter(where t.occurred_at>=now()-interval '28 days' and t.kind='purchase') count
 from public.transactions t join public.ledger_entries l on l.transaction_id=t.id and l.auth0_sub=t.auth0_sub
 left join public.transactions original on original.id::text=t.metadata->>'originalId' and original.auth0_sub=t.auth0_sub
 where t.auth0_sub=p_sub and (t.kind in('purchase','refund') or t.metadata->>'merchantRefund'='true') and l.account='external'
 and t.occurred_at>=now()-interval '56 days' group by 1,2)x),'[]'),
 'available',(select jsonb_object_agg(currency,available_minor) from public.wallets where auth0_sub=p_sub),
 'guide',jsonb_build_object('dismissed',coalesce((a.state->'guide'->>'dismissed')::boolean,false),'walletViewed',coalesce((a.state->'guide'->>'walletViewed')::boolean,false),'circlesViewed',coalesce((a.state->'guide'->>'circlesViewed')::boolean,false)),
 'steps',jsonb_build_object('funded',exists(select 1 from public.funding_orders where auth0_sub=p_sub and status='COMPLETED'),
 'goal',jsonb_array_length(coalesce(a.state->'goals','[]'))>0,'enabled',coalesce(p.savings_enabled,false),
 'purchased',exists(select 1 from public.transactions where auth0_sub=p_sub and kind='purchase')))
from public.account_state a join public.profiles p on p.auth0_sub=a.auth0_sub where a.auth0_sub=p_sub and a.user_id=p_uid;
$$;
revoke all on function public.walletwise_coach(text,text) from public,anon,authenticated;
grant execute on function public.walletwise_coach(text,text) to service_role;

-- Each threshold is awarded once for the lifetime of a Circle, even after a target increase.
create table public.circle_milestones (
 circle_id uuid not null references public.savings_circles(id), threshold smallint not null check(threshold in(25,50,75,100)),
 target_minor bigint not null check(target_minor>0), reached_at timestamptz not null default now(), primary key(circle_id,threshold)
);
alter table public.circle_milestones enable row level security;
revoke all on public.circle_milestones from public,anon,authenticated,service_role;
grant select on public.circle_milestones to service_role;
-- Baseline existing balances silently: do not invent historical activity/notifications.
insert into public.circle_milestones(circle_id,threshold,target_minor)
select c.id,v.n,c.target_minor from public.savings_circles c cross join(values(25),(50),(75),(100))v(n)
where c.balance_minor::numeric*100>=c.target_minor::numeric*v.n or c.reached_at is not null;
create or replace function private.circle_entry_balance() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.savings_circles; threshold integer; awarded integer;
begin
 update public.savings_circles set balance_minor=balance_minor+new.amount_minor,
 reached_at=case when balance_minor+new.amount_minor>=target_minor then coalesce(reached_at,now()) else reached_at end
 where id=new.circle_id returning * into strict c;
 update public.circle_members set outstanding_minor=outstanding_minor+new.amount_minor where id=new.member_id and circle_id=new.circle_id;
 if new.amount_minor>0 then
  for threshold in select n from(values(25),(50),(75),(100))v(n) where c.balance_minor::numeric*100>=c.target_minor::numeric*n loop
   insert into public.circle_milestones(circle_id,threshold,target_minor) values(c.id,threshold,c.target_minor) on conflict do nothing;
   get diagnostics awarded=row_count;
   if awarded=1 then
    insert into public.circle_activity(circle_id,member_id,event,details)values(c.id,new.member_id,'milestone',jsonb_build_object('threshold',threshold,'target',c.target_minor::text));
    perform 1 from public.account_state where auth0_sub in(select auth0_sub from public.circle_members where circle_id=c.id and active) order by user_id for update;
    update public.account_state set state=jsonb_set(state,'{notices}',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'at',now(),'title',case when threshold=100 then 'Circle goal reached' else 'Circle milestone reached' end,'body',c.name||' reached '||threshold||'% of its recorded target. Open Savings Circles to review progress.','read',false))||coalesce(state->'notices','[]')),version=version+1,updated_at=now()
    where auth0_sub in(select auth0_sub from public.circle_members where circle_id=c.id and active);
   end if;
  end loop;
 end if;
 return new;
end $$;
revoke all on function private.circle_entry_balance() from public,anon,authenticated;

create function public.walletwise_circle_timeline(p_sub text,p_id uuid,p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.circle_member(p_sub,p_id) then raise exception 'Circle access denied'; end if;
 return (select coalesce(jsonb_agg(x order by x.at desc,x.id desc),'[]') from (
 select * from (
 select e.id,e.created_at as at,e.member_id as "memberId",e.kind as event,jsonb_build_object('amount',e.amount_minor::text) as details from public.circle_entries e where circle_id=p_id
 union all select a.id,a.created_at,a.member_id,a.event,a.details-array['hash'] from public.circle_activity a where circle_id=p_id
 )events where p_before is null or (at,id)<(p_before,p_before_id) order by at desc,id desc limit 26)x);
end $$;
revoke all on function public.walletwise_circle_timeline(text,uuid,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.walletwise_circle_timeline(text,uuid,timestamptz,uuid) to service_role;

-- Signed external postings distinguish purchase gross, refunds and net spending.
alter function public.walletwise_dashboard(text,text,text) rename to walletwise_dashboard_before_enhancements;
revoke all on function public.walletwise_dashboard_before_enhancements(text,text,text) from public,anon,authenticated,service_role;
create function public.walletwise_dashboard(p_sub text,p_uid text,p_timezone text default 'UTC') returns jsonb language sql stable security definer set search_path='' as $$
select case when d is null then null else jsonb_set(d,'{dashboard,dailySpending}',coalesce((select jsonb_agg(jsonb_build_object('day',day,'currency',currency,'amount',net::text,'gross',gross::text,'refunds',refunds::text)) from (
 select (t.occurred_at at time zone p_timezone)::date as day,l.currency,sum(l.amount_minor) net,
 sum(case when t.kind='purchase' then l.amount_minor else 0 end) gross,
 -sum(case when t.kind='refund' or t.metadata->>'merchantRefund'='true' then l.amount_minor else 0 end) refunds
 from public.transactions t join public.ledger_entries l on l.transaction_id=t.id and l.auth0_sub=t.auth0_sub
 where t.auth0_sub=p_sub and (t.kind in('purchase','refund') or t.metadata->>'merchantRefund'='true') and l.account='external'
 and t.occurred_at>=((now() at time zone p_timezone)::date-31)::timestamp at time zone p_timezone group by 1,2)x),'[]')) end
from public.walletwise_dashboard_before_enhancements(p_sub,p_uid,p_timezone)d;
$$;
revoke all on function public.walletwise_dashboard(text,text,text) from public,anon,authenticated;
grant execute on function public.walletwise_dashboard(text,text,text) to service_role;

alter table public.circle_proposals add column creator_member_id uuid references public.circle_members(id);
create function private.record_proposal_creator() returns trigger language plpgsql security definer set search_path='' as $$
begin
 select m.id into new.creator_member_id from public.circle_members m join public.savings_circles c on c.id=m.circle_id where c.id=new.circle_id and m.auth0_sub=c.owner_sub;
 return new;
end $$;
create trigger proposal_creator before insert on public.circle_proposals for each row execute function private.record_proposal_creator();
revoke all on function private.record_proposal_creator() from public,anon,authenticated;
alter function public.walletwise_circles(text,uuid) rename to walletwise_circles_before_enhancements;
revoke all on function public.walletwise_circles_before_enhancements(text,uuid) from public,anon,authenticated,service_role;
create function public.walletwise_circles(p_sub text,p_id uuid default null) returns jsonb language sql stable security definer set search_path='' as $$
select case when p_id is null then d else jsonb_set(d,'{proposals}',coalesce((select jsonb_agg(v.value||jsonb_build_object('createdAt',r.created_at,'creatorId',r.creator_member_id) order by r.created_at desc,r.id desc) from jsonb_array_elements(d->'proposals')v(value) join public.circle_proposals r on r.id::text=v.value->>'id'),'[]')) end
from public.walletwise_circles_before_enhancements(p_sub,p_id)d;
$$;
revoke all on function public.walletwise_circles(text,uuid) from public,anon,authenticated;
grant execute on function public.walletwise_circles(text,uuid) to service_role;
notify pgrst, 'reload schema';

-- New suggestions capture every currency rule and destination, rechecked under financial locks.
create function public.walletwise_accept_reviewed_rule(p_auth0_sub text,p_currency text,p_current bigint,p_cap bigint,p_suggested bigint,p_ledger_revision text,p_settings jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare p public.profiles; increments jsonb; caps jsonb; funds bigint;
begin
 perform 1 from public.wallets where auth0_sub=p_auth0_sub order by currency for update;
 select * into strict p from public.profiles where auth0_sub=p_auth0_sub for update;
 perform 1 from public.savings_rules where auth0_sub=p_auth0_sub order by currency for update;
 select jsonb_object_agg(currency,increment_minor),jsonb_object_agg(currency,cap_minor) into increments,caps from public.savings_rules where auth0_sub=p_auth0_sub;
 if p_settings is null or coalesce(p.wallet_preferences->'savingsDestination','null') is distinct from p_settings->'destination'
 or increments is distinct from p_settings->'increments' or caps is distinct from p_settings->'caps' then raise exception 'Savings settings changed; generate a new report'; end if;
 select available_minor into strict funds from public.wallets where auth0_sub=p_auth0_sub and currency=p_currency;
 if funds<least(p_suggested,p_cap) then raise exception 'Review available funds before increasing savings'; end if;
 perform public.walletwise_accept_savings_rule(p_auth0_sub,p_currency,p_current,p_cap,p_suggested,p_ledger_revision);
end $$;
revoke all on function public.walletwise_accept_reviewed_rule(text,text,bigint,bigint,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.walletwise_accept_reviewed_rule(text,text,bigint,bigint,bigint,text,jsonb) to service_role;
notify pgrst, 'reload schema';
