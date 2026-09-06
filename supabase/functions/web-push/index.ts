import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import webpush from 'npm:web-push@3.6.7';
import { occurrenceDates } from '../../../src/domain/recurrence.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const allowedEndpoint = (endpoint: string) => {
  try { const u = new URL(endpoint); return u.protocol === 'https:' && !u.username && !u.password && !u.port && ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(u.hostname); } catch { return false; }
};
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  const publicKey = Deno.env.get('VORA_VAPID_PUBLIC_KEY'), privateKey = Deno.env.get('VORA_VAPID_PRIVATE_KEY');
  if (!publicKey || !privateKey) return json({ error: 'Push not configured' }, 503);
  if (request.method === 'GET') return json({ publicKey });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const token = request.headers.get('authorization')?.replace(/^Bearer /i, '') ?? '';
  const schedulerToken = Deno.env.get('VORA_PUSH_SCHEDULER_TOKEN');
  const scheduled = !!schedulerToken && request.headers.get('x-vora-scheduler-token') === schedulerToken;
  let userId: string | undefined;
  if (!scheduled) {
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) return json({ error: 'Unauthorized' }, 401);
    userId = data.user.id;
    let payload; try { payload = await request.json(); } catch { return json({ error: 'Invalid request' }, 400); }
    if (payload.test !== true) return json({ error: 'Forbidden' }, 403);
    // Database rate limit survives cold starts and parallel function invocations.
    const { data: allowed, error: rateError } = await db.rpc('claim_push_test', { p_user: userId });
    if (rateError || !allowed) return json({ error: 'Retry after one minute' }, 429);
  }
  webpush.setVapidDetails(Deno.env.get('VORA_VAPID_SUBJECT') ?? 'https://vora.app', publicKey, privateKey);
  let sent = 0, failed = 0;
  try {
    async function all(table: string, configure: (query: any) => any) {
      const rows: any[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await configure(db.from(table).select('*')).order('id').range(offset, offset + 499);
        if (error) throw error;
        rows.push(...data); if (data.length < 500) return rows;
      }
    }
    const subscriptions = await all('web_push_subscriptions', (q) => userId ? q.eq('user_id', userId) : q);
    async function send(subscription: any, payload: unknown): Promise<boolean> {
      if (!allowedEndpoint(subscription.endpoint)) { failed++; return false; }
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: subscription.keys }, JSON.stringify(payload), { TTL: 300, timeout: 10000 });
        sent++; return true;
      } catch (error) {
        failed++;
        if ([404, 410].includes((error as { statusCode?: number }).statusCode ?? 0)) await db.from('web_push_subscriptions').delete().eq('id', subscription.id);
        return false;
      }
    }
    if (userId) {
      if (!subscriptions.length) return json({ error: 'No subscriptions' }, 409);
      for (const subscription of subscriptions) await send(subscription, { title: 'VORA', body: 'การแจ้งเตือนพร้อมใช้งาน · Notifications are ready', url: '/' });
      return json({ sent, failed }, failed ? 502 : 200);
    }
    if (!subscriptions.length) return json({ sent, failed });
    const now = new Date(), from = new Date(now.getTime() - 5 * 60000);
    const items = await all('items', (q) => q.is('deleted_at', null).eq('done', false).neq('type', 'note').not('start_at', 'is', null));
    for (const item of items) {
      const alarmItem = item.all_day ? { ...item, start_at: `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(item.start_at))}T08:00:00+07:00` } : item;
      const dates = item.recurrence ? occurrenceDates(alarmItem, from, now) : [new Date(alarmItem.start_at)].filter((d) => d >= from && d <= now);
      if (!dates.length) continue;
      let members = [item.user_id];
      if (item.household_id) {
        const { data, error } = await db.from('household_members').select('user_id').eq('household_id', item.household_id);
        if (error) throw error;
        members = data.map((m) => m.user_id);
      }
      const recipients = subscriptions.filter((s) => members.includes(s.user_id) && (!item.household_id || item.details?.notify_user_ids == null || item.details.notify_user_ids.includes(s.user_id)));
      for (const subscription of recipients) for (const date of dates) {
        if (date.getTime() < Date.parse(subscription.created_at)) continue;
        const occurrence = date.toISOString();
        const { data: claimed, error } = await db.rpc('claim_web_push', { p_subscription: subscription.id, p_item: item.id, p_owner: item.user_id, p_occurrence: occurrence });
        if (error) throw error;
        if (!claimed) continue;
        // Avoid titles/body on lock screens by default. The authenticated app
        // resolves the id and checks visibility when the notification is opened.
        if (await send(subscription, { title: 'VORA', body: 'มีรายการถึงเวลาแล้ว · A reminder is due', url: `/?item=${encodeURIComponent(item.id)}`, tag: `${item.id}:${occurrence}` })) {
          const { error: updateError } = await db.from('web_push_deliveries').update({ sent_at: new Date().toISOString() }).eq('subscription_id', subscription.id).eq('item_id', item.id).eq('item_user_id', item.user_id).eq('occurrence_at', occurrence);
          if (updateError) throw updateError;
        }
      }
    }
    return json({ sent, failed }, failed ? 502 : 200);
  } catch { return json({ error: 'Push processing failed', sent, failed }, 500); }
});
