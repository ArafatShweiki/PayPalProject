-- Keep goal identity for immutable financial history, but remove deleted goals
-- from the user's goal list. All balance movements and deletion commit together.
alter table public.savings_goals add column deleted_at timestamptz;
create function public.walletwise_delete_savings_goal(p_sub text,p_uid text,p_goal uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare g public.savings_goals; saved bigint; result jsonb;
begin
 perform 1 from public.wallets where auth0_sub=p_sub order by currency for update;
 perform 1 from public.account_state where auth0_sub=p_sub and user_id=p_uid for update;
 if not found then raise exception 'Select an owned goal'; end if;
 select * into g from public.savings_goals where id=p_goal and auth0_sub=p_sub for update;
 if not found then raise exception 'Select an owned goal'; end if;
 if g.deleted_at is not null then
   return jsonb_build_object('deleted',true,'currency',g.currency,'alreadyDeleted',true);
 end if;
 select coalesce(sum(amount_minor),0) into saved from public.goal_savings_entries
 where auth0_sub=p_sub and goal_id=p_goal and currency=g.currency;
 if saved<0 then raise exception 'Insufficient savings destination balance'; end if;
 if saved>0 then
   perform public.walletwise_apply_transaction(p_sub,gen_random_uuid(),'delete-goal:'||p_goal,
     'adjustment','Deleted goal: '||g.name,'Savings',
     jsonb_build_array(
       jsonb_build_object('currency',g.currency,'account','savings','amount_minor',-saved),
       jsonb_build_object('currency',g.currency,'account','available','amount_minor',saved)),
     jsonb_build_object('goalId',p_goal,'deletedGoal',true));
 end if;
 update public.savings_goals set deleted_at=now(),archived_at=coalesce(archived_at,now()) where id=p_goal;
 update public.profiles set savings_enabled=false,
   wallet_preferences=jsonb_set(wallet_preferences,'{savingsDestination}','null')
 where auth0_sub=p_sub and wallet_preferences->'savingsDestination'->>'kind'='goal'
   and wallet_preferences->'savingsDestination'->>'id'=p_goal::text;
 update public.profiles set wallet_preferences=jsonb_set(wallet_preferences,'{goalIds}',
   coalesce((select jsonb_object_agg(key,value) from jsonb_each(coalesce(wallet_preferences->'goalIds','{}')) where value<>to_jsonb(p_goal::text)),'{}'))
 where auth0_sub=p_sub;
 update public.account_state set state=jsonb_set(state,'{goals}',
   (select coalesce(jsonb_agg(x),'[]') from jsonb_array_elements(state->'goals') x where x->>'id'<>p_goal::text)),
   version=version+1,updated_at=now() where auth0_sub=p_sub and user_id=p_uid;
 return jsonb_build_object('deleted',true,'currency',g.currency,'returnedMinor',saved::text);
end $$;
revoke all on function public.walletwise_delete_savings_goal(text,text,uuid) from public,anon,authenticated;
grant execute on function public.walletwise_delete_savings_goal(text,text,uuid) to service_role;

-- Once a goal's savings have returned to available funds, a purchase refund
-- retains that released saving; it must not debit another goal.
create or replace function public.walletwise_goal_refund(p_sub text,p_key uuid,p_original uuid) returns jsonb language plpgsql security definer set search_path='' as $$
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
 if exists(select 1 from public.savings_goals g where g.id::text=original.metadata->>'goalId' and g.auth0_sub=p_sub and g.deleted_at is not null) then
   -- The savings have already been released in their own currency. Refund
   -- only the merchant charge, just as for a retained Circle contribution.
   select jsonb_build_array(
     jsonb_build_object('currency',currency,'account','available','amount_minor',merchant),
     jsonb_build_object('currency',currency,'account','external','amount_minor',-merchant)) into entries
   from (
     select l.currency, coalesce((original.metadata->>'purchaseAmount')::bigint,
       (select sum(e.amount_minor) from public.ledger_entries e where e.transaction_id=p_original and e.account='external' and e.currency=l.currency)) as merchant
     from public.ledger_entries l where l.transaction_id=p_original and l.auth0_sub=p_sub and l.account='available' and l.amount_minor<0 limit 1
   ) charge;
   return public.walletwise_apply_transaction(p_sub,p_key,'refund:'||p_original,'adjustment','Refund: '||original.description,original.category,entries,
     jsonb_build_object('originalId',p_original,'merchantRefund',true,'savingsRetained',true,'sourceSaving',0));
 end if;
 select jsonb_agg(jsonb_build_object('currency',currency,'account',account,'amount_minor',-amount_minor)) into entries from public.ledger_entries where transaction_id=p_original and auth0_sub=p_sub;
 result:=public.walletwise_apply_transaction(p_sub,p_key,'refund:'||p_original,'refund','Refund: '||original.description,original.category,entries,
  original.metadata||jsonb_build_object('originalId',p_original));
 return result;
end $$;
