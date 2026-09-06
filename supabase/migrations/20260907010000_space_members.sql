create or replace function public.list_space_members(p_space_id uuid)
returns table(user_id uuid, name text)
language sql stable security definer set search_path = public
as $$
  select m.user_id, coalesce(nullif(u.raw_user_meta_data->>'full_name',''), nullif(u.raw_user_meta_data->>'name',''), 'Member ' || left(m.user_id::text, 6))
  from public.household_members m join auth.users u on u.id=m.user_id
  where m.household_id=p_space_id and public.is_household_member(p_space_id);
$$;
revoke all on function public.list_space_members(uuid) from public;
grant execute on function public.list_space_members(uuid) to authenticated;
