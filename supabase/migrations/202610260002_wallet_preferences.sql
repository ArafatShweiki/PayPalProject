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
