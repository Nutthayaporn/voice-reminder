-- Shared household spaces. Personal items keep household_id = null; shared
-- items are readable and editable by every authenticated household member.

create table if not exists public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 80),
  invite_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  created_by  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

alter table public.households enable row level security;
alter table public.household_members enable row level security;

create or replace function public.is_household_member(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.household_members
    where household_id = p_household_id and user_id = auth.uid()
  );
$$;

revoke all on function public.is_household_member(uuid) from public;
grant execute on function public.is_household_member(uuid) to authenticated;

drop policy if exists "households member read" on public.households;
create policy "households member read" on public.households
  for select to authenticated
  using (public.is_household_member(id));

drop policy if exists "household members read" on public.household_members;
create policy "household members read" on public.household_members
  for select to authenticated
  using (public.is_household_member(household_id));

create or replace function public.create_household(p_name text)
returns table (id uuid, name text, invite_code text, role text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  created public.households%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(trim(p_name)) < 1 then raise exception 'Household name is required'; end if;

  insert into public.households (name, created_by)
  values (trim(p_name), auth.uid())
  returning * into created;

  insert into public.household_members (household_id, user_id, role)
  values (created.id, auth.uid(), 'owner');

  return query select created.id, created.name, created.invite_code, 'owner'::text, created.created_at;
end;
$$;

create or replace function public.join_household(p_invite_code text)
returns table (id uuid, name text, invite_code text, role text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.households%rowtype;
  member_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into target
  from public.households h
  where h.invite_code = upper(trim(p_invite_code));

  if target.id is null then raise exception 'Invite code not found'; end if;

  insert into public.household_members (household_id, user_id, role)
  values (target.id, auth.uid(), 'member')
  on conflict (household_id, user_id) do nothing;

  select hm.role into member_role
  from public.household_members hm
  where hm.household_id = target.id and hm.user_id = auth.uid();

  return query select target.id, target.name, target.invite_code, member_role, target.created_at;
end;
$$;

create or replace function public.list_households()
returns table (id uuid, name text, invite_code text, role text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select h.id, h.name, h.invite_code, hm.role, h.created_at
  from public.households h
  join public.household_members hm on hm.household_id = h.id
  where hm.user_id = auth.uid()
  order by h.created_at asc;
$$;

revoke all on function public.create_household(text) from public;
revoke all on function public.join_household(text) from public;
revoke all on function public.list_households() from public;
grant execute on function public.create_household(text) to authenticated;
grant execute on function public.join_household(text) to authenticated;
grant execute on function public.list_households() to authenticated;

alter table public.items
  add column if not exists household_id uuid references public.households(id) on delete cascade;

-- Item IDs are generated locally with time + randomness. Making the ID the
-- single conflict key lets another member update a shared row without knowing
-- which member originally created it.
alter table public.items drop constraint if exists items_pkey;
alter table public.items add primary key (id);

create index if not exists items_household_updated_idx
  on public.items (household_id, updated_at desc);

drop policy if exists "items owner" on public.items;
drop policy if exists "items personal or household" on public.items;
create policy "items personal or household" on public.items
  for all to authenticated
  using (
    (household_id is null and user_id = auth.uid())
    or (household_id is not null and public.is_household_member(household_id))
  )
  with check (
    (household_id is null and user_id = auth.uid())
    or (household_id is not null and public.is_household_member(household_id))
  );

drop function if exists public.upsert_item_lww(
  text, text, text, text, timestamptz, timestamptz, boolean,
  jsonb, text, boolean, integer, integer, text[], text, boolean, timestamptz, timestamptz
);

create or replace function public.upsert_item_lww(
  p_id text,
  p_household_id uuid,
  p_type text,
  p_title text,
  p_body text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_all_day boolean,
  p_recurrence jsonb,
  p_alert_mode text,
  p_remind_until_done boolean,
  p_snooze_minutes integer,
  p_max_attempts integer,
  p_people text[],
  p_raw_text text,
  p_done boolean,
  p_created_at timestamptz,
  p_updated_at timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  affected integer;
begin
  insert into public.items (
    id, user_id, household_id, type, title, body, start_at, end_at, all_day,
    recurrence, alert_mode, remind_until_done, snooze_minutes, max_attempts,
    people, raw_text, done, created_at, updated_at, deleted_at
  ) values (
    p_id, auth.uid(), p_household_id, p_type, p_title, p_body, p_start_at, p_end_at, p_all_day,
    p_recurrence,
    case when coalesce(p_remind_until_done, false) then 'alarm' else coalesce(p_alert_mode, 'notification') end,
    coalesce(p_remind_until_done, false), coalesce(p_snooze_minutes, 10),
    coalesce(p_max_attempts, 5), p_people, p_raw_text, p_done, p_created_at, p_updated_at, null
  )
  on conflict (id) do update set
    household_id = excluded.household_id,
    type = excluded.type,
    title = excluded.title,
    body = excluded.body,
    start_at = excluded.start_at,
    end_at = excluded.end_at,
    all_day = excluded.all_day,
    recurrence = excluded.recurrence,
    alert_mode = excluded.alert_mode,
    remind_until_done = excluded.remind_until_done,
    snooze_minutes = excluded.snooze_minutes,
    max_attempts = excluded.max_attempts,
    people = excluded.people,
    raw_text = excluded.raw_text,
    done = excluded.done,
    updated_at = excluded.updated_at,
    deleted_at = null
  where excluded.updated_at >= public.items.updated_at;

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

create or replace function public.delete_item_lww(p_id text, p_updated_at timestamptz)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  affected integer;
begin
  update public.items
  set deleted_at = p_updated_at, updated_at = p_updated_at
  where id = p_id and updated_at <= p_updated_at;
  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

revoke all on function public.upsert_item_lww(
  text, uuid, text, text, text, timestamptz, timestamptz, boolean,
  jsonb, text, boolean, integer, integer, text[], text, boolean, timestamptz, timestamptz
) from public;
grant execute on function public.upsert_item_lww(
  text, uuid, text, text, text, timestamptz, timestamptz, boolean,
  jsonb, text, boolean, integer, integer, text[], text, boolean, timestamptz, timestamptz
) to authenticated;
