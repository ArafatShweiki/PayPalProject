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
