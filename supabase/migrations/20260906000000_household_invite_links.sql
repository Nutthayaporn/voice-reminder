-- Preview an invite before joining so deep links can show a safe confirmation
-- screen. The caller must already know the invite code, and only authenticated
-- users can call this function.

create or replace function public.preview_household_invite(p_invite_code text)
returns table (name text, already_member boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    h.name,
    exists (
      select 1
      from public.household_members hm
      where hm.household_id = h.id and hm.user_id = auth.uid()
    ) as already_member
  from public.households h
  where auth.uid() is not null
    and h.invite_code = upper(trim(p_invite_code));
$$;

revoke all on function public.preview_household_invite(text) from public;
grant execute on function public.preview_household_invite(text) to authenticated;
