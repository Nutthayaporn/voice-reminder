-- Voice Reminder cloud sync: owner-only items + client-timestamp LWW writes.
-- Apply with Supabase CLI (`supabase db push`) or paste into the SQL editor.

create table if not exists public.items (
  -- Local-first versions used compact string IDs before cloud sync existed;
  -- keep text so existing on-device records migrate without changing identity.
  id            text not null,
  user_id       uuid not null references auth.users(id) on delete cascade,
  type          text not null check (type in ('reminder', 'event', 'todo', 'note')),
  title         text not null,
  body          text,
  start_at      timestamptz,
  end_at        timestamptz,
  all_day       boolean not null default false,
  recurrence    jsonb,
  alert_mode    text not null default 'notification'
                check (alert_mode in ('notification', 'alarm')),
  remind_until_done boolean not null default false,
  snooze_minutes integer not null default 10 check (snooze_minutes in (5, 10, 30)),
  max_attempts  integer not null default 5 check (max_attempts between 1 and 20),
  people        text[],
  raw_text      text,
  done          boolean not null default false,
  created_at    timestamptz not null,
  updated_at    timestamptz not null,
  deleted_at    timestamptz,
  primary key (user_id, id)
);

alter table public.items drop constraint if exists items_until_done_alarm_check;
alter table public.items
  add constraint items_until_done_alarm_check
  check (not remind_until_done or alert_mode = 'alarm');

-- If an early draft of the schema was applied with uuid IDs, preserve every
-- value while widening the column for legacy local string IDs.
alter table public.items alter column id drop default;
alter table public.items alter column id type text using id::text;
alter table public.items drop constraint if exists items_pkey;
alter table public.items add primary key (user_id, id);

create index if not exists items_user_updated_idx
  on public.items (user_id, updated_at desc);

alter table public.items enable row level security;
grant select, insert, update on public.items to authenticated;

drop policy if exists "items owner" on public.items;
create policy "items owner" on public.items
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- The app supplies updated_at when the local edit happens. The WHERE clause is
-- the conflict guard: replaying an older offline operation cannot overwrite a
-- newer edit already stored by another device.
create or replace function public.upsert_item_lww(
  p_id text,
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
    id, user_id, type, title, body, start_at, end_at, all_day,
    recurrence, alert_mode, remind_until_done, snooze_minutes, max_attempts,
    people, raw_text, done, created_at, updated_at, deleted_at
  ) values (
    p_id, auth.uid(), p_type, p_title, p_body, p_start_at, p_end_at, p_all_day,
    p_recurrence,
    case when coalesce(p_remind_until_done, false) then 'alarm' else coalesce(p_alert_mode, 'notification') end,
    coalesce(p_remind_until_done, false), coalesce(p_snooze_minutes, 10),
    coalesce(p_max_attempts, 5), p_people, p_raw_text, p_done, p_created_at, p_updated_at, null
  )
  on conflict (user_id, id) do update set
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

create or replace function public.delete_item_lww(
  p_id text,
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
  update public.items
  set deleted_at = p_updated_at,
      updated_at = p_updated_at
  where id = p_id
    and user_id = auth.uid()
    and updated_at <= p_updated_at;

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

revoke all on function public.upsert_item_lww(
  text, text, text, text, timestamptz, timestamptz, boolean,
  jsonb, text, boolean, integer, integer, text[], text, boolean, timestamptz, timestamptz
) from public;
revoke all on function public.delete_item_lww(text, timestamptz) from public;

grant execute on function public.upsert_item_lww(
  text, text, text, text, timestamptz, timestamptz, boolean,
  jsonb, text, boolean, integer, integer, text[], text, boolean, timestamptz, timestamptz
) to authenticated;
grant execute on function public.delete_item_lww(text, timestamptz) to authenticated;

-- Realtime is optional for correctness (foreground sync still runs), but gives
-- near-instant propagation while two devices are open.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'items'
  ) then
    alter publication supabase_realtime add table public.items;
  end if;
end $$;
