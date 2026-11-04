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

