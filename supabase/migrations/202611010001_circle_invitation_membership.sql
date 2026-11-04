-- Private membership-aware invitation reads; public previews remain unchanged.
create function public.walletwise_invitation_status(p_sub text, p_hash text)
returns jsonb language sql stable security definer set search_path='' as $$
 select public.walletwise_invitation_preview(p_hash) || jsonb_build_object(
  'alreadyMember', exists(select 1 from public.circle_members m
    where m.circle_id=i.circle_id and m.auth0_sub=p_sub and m.active),
  'circleId', case when exists(select 1 from public.circle_members m
    where m.circle_id=i.circle_id and m.auth0_sub=p_sub and m.active)
    then i.circle_id else null end)
 from public.circle_invitations i join public.savings_circles c on c.id=i.circle_id
 where i.token_hash=p_hash and i.revoked_at is null and i.expires_at>now() and not c.archived;
$$;

-- Lock the same Circle row as the command function before testing membership.
-- Repeated clicks/tabs return membership without writing another join event.
create function public.walletwise_join_circle(p_sub text, p_hash text, p_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare circle_id uuid; status jsonb;
begin
 select i.circle_id into circle_id from public.circle_invitations i where i.token_hash=p_hash;
 if circle_id is null then raise exception 'Invitation unavailable'; end if;
 perform 1 from public.savings_circles c where c.id=circle_id for update;
 status:=public.walletwise_invitation_status(p_sub,p_hash);
 if status is null then raise exception 'Invitation unavailable'; end if;
 if (status->>'alreadyMember')::boolean then
  return jsonb_build_object('id',circle_id,'alreadyMember',true);
 end if;
 return public.walletwise_circle_command(p_sub,'join',null,p_key,jsonb_build_object('hash',p_hash))
  || jsonb_build_object('alreadyMember',false);
end $$;

revoke all on function public.walletwise_invitation_status(text,text) from public,anon,authenticated;
revoke all on function public.walletwise_join_circle(text,text,uuid) from public,anon,authenticated;
grant execute on function public.walletwise_invitation_status(text,text) to service_role;
grant execute on function public.walletwise_join_circle(text,text,uuid) to service_role;
notify pgrst, 'reload schema';
