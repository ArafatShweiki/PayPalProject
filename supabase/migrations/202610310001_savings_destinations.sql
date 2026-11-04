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
