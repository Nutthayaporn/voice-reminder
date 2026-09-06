// Initial provisioning only. Server keys never enter the app bundle or repo.
// node --env-file=.env scripts/setup-web-push.mjs
import { createECDH, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const base = process.env.EXPO_PUBLIC_SUPABASE_URL, anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!base || !anon || !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(base)) throw new Error('Configure the linked Supabase project in .env');
const url = `${base}/functions/v1/web-push`;
const existing = await fetch(url, { headers: { Authorization: `Bearer ${anon}` } });
if (existing.ok) throw new Error('Already configured. Preserve existing VAPID keys; do not run initial setup again.');
if (existing.status !== 503) throw new Error(`Cannot verify initial state (${existing.status})`);
const key = createECDH('prime256v1'); key.generateKeys();
const scheduler = randomBytes(32).toString('base64url');
const directory = mkdtempSync(join(tmpdir(), 'vora-push-'));
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
try {
  const env = join(directory, 'secrets.env');
  writeFileSync(env, `VORA_VAPID_PUBLIC_KEY=${key.getPublicKey().toString('base64url')}\nVORA_VAPID_PRIVATE_KEY=${key.getPrivateKey().toString('base64url')}\nVORA_VAPID_SUBJECT=${base}\nVORA_PUSH_SCHEDULER_TOKEN=${scheduler}\n`, { mode: 0o600 });
  execFileSync('supabase', ['secrets','set','--env-file',env], { stdio: ['ignore','pipe','pipe'] });
  const sql = join(directory, 'cron.sql');
  writeFileSync(sql, `
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $setup$
begin
  if exists(select 1 from vault.secrets where name in ('vora_push_url','vora_push_scheduler_token','vora_push_anon')) then
    raise exception 'Push vault secrets exist; preserve them and inspect configuration';
  end if;
  perform vault.create_secret(${quote(url)}, 'vora_push_url');
  perform vault.create_secret(${quote(scheduler)}, 'vora_push_scheduler_token');
  perform vault.create_secret(${quote(anon)}, 'vora_push_anon');
end $setup$;
select cron.schedule('vora-web-push', '* * * * *', $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='vora_push_url'),
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='vora_push_anon'), 'x-vora-scheduler-token', (select decrypted_secret from vault.decrypted_secrets where name='vora_push_scheduler_token')),
    body := '{}'::jsonb, timeout_milliseconds := 55000
  );
$cron$);
select cron.schedule('vora-push-cleanup', '17 3 * * *', $cron$
  delete from public.web_push_deliveries where occurrence_at < now()-interval '30 days';
$cron$);
`, { mode: 0o600 });
  execFileSync('supabase', ['db','query','--linked','--file',sql], { stdio: ['ignore','pipe','pipe'] });
  console.log('Web Push secrets and minute scheduler configured with platform JWT verification.');
} catch {
  throw new Error('Provisioning failed. Inspect secret names and cron status before retrying. CLI output is hidden because it may contain SQL secrets.');
} finally { rmSync(directory, { recursive: true, force: true }); }
