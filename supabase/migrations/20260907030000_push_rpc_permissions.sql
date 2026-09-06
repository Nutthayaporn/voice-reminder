-- Supabase default privileges can grant EXECUTE directly to API roles, so
-- revoking PUBLIC alone is insufficient for service-only functions.
revoke all on function public.claim_web_push(uuid,text,uuid,timestamptz) from anon, authenticated;
revoke all on function public.claim_push_test(uuid) from anon, authenticated;
grant execute on function public.claim_web_push(uuid,text,uuid,timestamptz) to service_role;
grant execute on function public.claim_push_test(uuid) to service_role;
