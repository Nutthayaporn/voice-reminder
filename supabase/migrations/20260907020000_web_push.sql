create table public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  endpoint text not null unique check (length(endpoint) < 4096),
  keys jsonb not null check (keys ? 'auth' and keys ? 'p256dh'),
  created_at timestamptz not null default now()
);
alter table public.web_push_subscriptions enable row level security;
create policy "own push subscriptions" on public.web_push_subscriptions for all to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.web_push_subscriptions to authenticated;
create table public.web_push_deliveries (
  subscription_id uuid not null references public.web_push_subscriptions(id) on delete cascade,
  item_id text not null,
  item_user_id uuid not null,
  foreign key (item_id) references public.items(id) on delete cascade,
  occurrence_at timestamptz not null,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  primary key(subscription_id, item_user_id, item_id, occurrence_at)
);
alter table public.web_push_deliveries enable row level security;
-- Atomic lease prevents overlapping cron invocations from sending together.
create function public.claim_web_push(p_subscription uuid, p_item text, p_owner uuid, p_occurrence timestamptz)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  insert into web_push_deliveries(subscription_id,item_user_id,item_id,occurrence_at)
  values(p_subscription,p_owner,p_item,p_occurrence)
  on conflict(subscription_id,item_user_id,item_id,occurrence_at) do update set claimed_at=now()
  where web_push_deliveries.sent_at is null and web_push_deliveries.claimed_at < now()-interval '2 minutes';
  return found;
end $$;
revoke all on function public.claim_web_push(uuid,text,uuid,timestamptz) from public;
grant execute on function public.claim_web_push(uuid,text,uuid,timestamptz) to service_role;
create table public.web_push_test_limits(user_id uuid primary key references auth.users(id) on delete cascade, attempted_at timestamptz not null);
alter table public.web_push_test_limits enable row level security;
create function public.claim_push_test(p_user uuid) returns boolean language plpgsql security definer set search_path=public as $$
begin
  insert into web_push_test_limits values(p_user,now()) on conflict(user_id) do update set attempted_at=now()
  where web_push_test_limits.attempted_at < now()-interval '1 minute';
  return found;
end $$;
revoke all on function public.claim_push_test(uuid) from public;
grant execute on function public.claim_push_test(uuid) to service_role;
