-- Additive structured properties. Old clients preserve details on update.
begin;
alter table public.items add column if not exists details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object');
drop function if exists public.upsert_item_lww(text, uuid, text, text, text, timestamptz, timestamptz, boolean, jsonb, text, boolean, integer, integer, text[], text, boolean, timestamptz, timestamptz);
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
  p_updated_at timestamptz,
  p_details jsonb default null
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
    details, id, user_id, household_id, type, title, body, start_at, end_at, all_day,
    recurrence, alert_mode, remind_until_done, snooze_minutes, max_attempts,
    people, raw_text, done, created_at, updated_at, deleted_at
  ) values (
    coalesce(p_details, '{}'::jsonb), p_id, auth.uid(), p_household_id, p_type, p_title, p_body, p_start_at, p_end_at, p_all_day,
    p_recurrence,
    case when coalesce(p_remind_until_done, false) then 'alarm' else coalesce(p_alert_mode, 'notification') end,
    coalesce(p_remind_until_done, false), coalesce(p_snooze_minutes, 10),
    coalesce(p_max_attempts, 5), p_people, p_raw_text, p_done, p_created_at, p_updated_at, null
  )
  on conflict (id) do update set
    details = coalesce(p_details, public.items.details),
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


revoke all on function public.upsert_item_lww(text, uuid, text, text, text, timestamptz, timestamptz, boolean, jsonb, text, boolean, integer, integer, text[], text, boolean, timestamptz, timestamptz, jsonb) from public;
grant execute on function public.upsert_item_lww(text, uuid, text, text, text, timestamptz, timestamptz, boolean, jsonb, text, boolean, integer, integer, text[], text, boolean, timestamptz, timestamptz, jsonb) to authenticated;
commit;
