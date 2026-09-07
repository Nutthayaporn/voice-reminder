-- Provider credentials never enter the mobile/web bundle or shared items.
create table public.calendar_connections (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google', 'outlook')),
  tokens text not null, -- AES-GCM encrypted with CALENDAR_TOKEN_KEY
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);
create table public.calendar_oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google', 'outlook')),
  verifier text not null,
  return_url text not null,
  expires_at timestamptz not null
);
alter table public.calendar_connections enable row level security;
alter table public.calendar_oauth_states enable row level security;
revoke all on public.calendar_connections, public.calendar_oauth_states from public, anon, authenticated;
grant all on public.calendar_connections, public.calendar_oauth_states to service_role;

-- Consume the state and persist credentials in one transaction. Disconnect can
-- invalidate an in-flight callback before it completes, without resurrection.
create function public.complete_calendar_oauth(p_state_hash text, p_tokens text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare pending public.calendar_oauth_states;
begin
  delete from public.calendar_oauth_states
    where state_hash = p_state_hash and expires_at > now() returning * into pending;
  if not found then return false; end if;
  insert into public.calendar_connections(user_id, provider, tokens, updated_at)
    values(pending.user_id, pending.provider, p_tokens, now())
    on conflict(user_id, provider) do update set tokens = excluded.tokens, updated_at = excluded.updated_at;
  return true;
end;
$$;
revoke all on function public.complete_calendar_oauth(text, text) from public, anon, authenticated;
grant execute on function public.complete_calendar_oauth(text, text) to service_role;
