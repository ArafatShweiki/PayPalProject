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
