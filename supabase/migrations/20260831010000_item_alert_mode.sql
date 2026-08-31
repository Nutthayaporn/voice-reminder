-- Add per-reminder delivery mode and replace the LWW RPC used by existing installs.

alter table public.items
  add column if not exists alert_mode text not null default 'notification';

alter table public.items
  drop constraint if exists items_alert_mode_check;

alter table public.items
  add constraint items_alert_mode_check
  check (alert_mode in ('notification', 'alarm'));

drop function if exists public.upsert_item_lww(
  text, text, text, text, timestamptz, timestamptz, boolean,
  jsonb, text[], text, boolean, timestamptz, timestamptz
);

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
    recurrence, alert_mode, people, raw_text, done, created_at, updated_at, deleted_at
  ) values (
    p_id, auth.uid(), p_type, p_title, p_body, p_start_at, p_end_at, p_all_day,
    p_recurrence, coalesce(p_alert_mode, 'notification'), p_people, p_raw_text,
    p_done, p_created_at, p_updated_at, null
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

revoke all on function public.upsert_item_lww(
  text, text, text, text, timestamptz, timestamptz, boolean,
  jsonb, text, text[], text, boolean, timestamptz, timestamptz
) from public;

grant execute on function public.upsert_item_lww(
  text, text, text, text, timestamptz, timestamptz, boolean,
  jsonb, text, text[], text, boolean, timestamptz, timestamptz
) to authenticated;
