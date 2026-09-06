begin;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000071'), ('00000000-0000-4000-8000-000000000072');
insert into public.items(id,user_id,type,title,created_at,updated_at)
values ('vora-transaction-test','00000000-0000-4000-8000-000000000071','reminder','Synthetic push test',now(),now());
insert into public.web_push_subscriptions(id,user_id,endpoint,keys) values
('00000000-0000-4000-8000-000000000073','00000000-0000-4000-8000-000000000071','https://fcm.googleapis.com/test-rollback','{"auth":"test","p256dh":"test"}');
do $$ begin
  if not public.claim_web_push('00000000-0000-4000-8000-000000000073','vora-transaction-test','00000000-0000-4000-8000-000000000071','2026-09-07T09:00:00Z') then raise exception 'First claim failed'; end if;
  if public.claim_web_push('00000000-0000-4000-8000-000000000073','vora-transaction-test','00000000-0000-4000-8000-000000000071','2026-09-07T09:00:00Z') then raise exception 'Duplicate claim allowed'; end if;
  if not public.claim_push_test('00000000-0000-4000-8000-000000000071') or public.claim_push_test('00000000-0000-4000-8000-000000000071') then raise exception 'Test rate limit failed'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000072","role":"authenticated"}',true);
do $$ begin
  if exists(select 1 from public.web_push_subscriptions where id='00000000-0000-4000-8000-000000000073') then raise exception 'Cross-account read allowed'; end if;
  if has_function_privilege('authenticated','public.claim_web_push(uuid,text,uuid,timestamptz)','EXECUTE') then raise exception 'User can claim sends'; end if;
end $$;
reset role;
rollback;
select 'PASS: atomic duplicate suppression, test rate limit, subscription isolation; test data rolled back' as result;
