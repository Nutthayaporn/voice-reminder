import { createClient } from 'npm:@supabase/supabase-js@2';
import { googleEvent, outlookEvent, validRange } from '../../../src/integrations/calendar/model.ts';
import type { CalendarSource, CalendarEvent, CloudProvider } from '../../../src/integrations/calendar/model.ts';
const env = (name: string) => Deno.env.get(name) ?? '';
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
const callback = `${env('SUPABASE_URL')}/functions/v1/calendar-api`;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Cache-Control': 'no-store' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const random = () => b64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hash = async (value: string) => b64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function key() { return crypto.subtle.importKey('raw', unb64(env('CALENDAR_TOKEN_KEY')), 'AES-GCM', false, ['encrypt', 'decrypt']); }
async function seal(value: unknown, owner: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(owner) }, await key(), new TextEncoder().encode(JSON.stringify(value)));
  return `${b64(iv)}.${b64(new Uint8Array(encrypted))}`;
}
async function unseal(value: string, owner: string) {
  const [iv, data] = value.split('.');
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: new TextEncoder().encode(owner) }, await key(), unb64(data))));
}
function settings(provider: CloudProvider) {
  const google = provider === 'google';
  return { client_id: env(google ? 'GOOGLE_CALENDAR_CLIENT_ID' : 'MICROSOFT_CALENDAR_CLIENT_ID'),
    client_secret: env(google ? 'GOOGLE_CALENDAR_CLIENT_SECRET' : 'MICROSOFT_CALENDAR_CLIENT_SECRET'),
    authorize: google ? 'https://accounts.google.com/o/oauth2/v2/auth' : 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: google ? 'https://oauth2.googleapis.com/token' : 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: google ? 'https://www.googleapis.com/auth/calendar.readonly' : 'offline_access https://graph.microsoft.com/Calendars.Read' };
}
function ready(provider: CloudProvider) { const s = settings(provider); return !!(s.client_id && s.client_secret && env('CALENDAR_TOKEN_KEY') && env('CALENDAR_RETURN_URLS')); }
function providerOf(value: unknown): CloudProvider {
  if (value !== 'google' && value !== 'outlook') throw new Error('Unsupported calendar provider.');
  return value;
}
async function exchange(provider: CloudProvider, fields: Record<string, string>) {
  const s = settings(provider);
  const response = await fetch(s.token, { method: 'POST', body: new URLSearchParams({ client_id: s.client_id, client_secret: s.client_secret, ...fields }), signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('Calendar authorization expired or was declined. Connect again.');
  const tokens = await response.json();
  if (!tokens.access_token || !tokens.expires_in) throw new Error('Calendar authorization failed.');
  return { ...tokens, expires_at: Date.now() + tokens.expires_in * 1000 };
}
async function access(user: string, provider: CloudProvider) {
  const { data, error } = await db.from('calendar_connections').select('tokens').eq('user_id', user).eq('provider', provider).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Connect this calendar first.');
  const tokens = await unseal(data.tokens, `${user}:${provider}`);
  if (tokens.expires_at > Date.now() + 60000) return tokens.access_token as string;
  const next = await exchange(provider, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
  next.refresh_token ||= tokens.refresh_token;
  const { error: saveError } = await db.from('calendar_connections').update({ tokens: await seal(next, `${user}:${provider}`), updated_at: new Date().toISOString() }).eq('user_id', user).eq('provider', provider).eq('tokens', data.tokens);
  if (saveError) throw saveError;
  return next.access_token as string;
}
async function pages(url: string, token: string, provider: CloudProvider): Promise<any[]> {
  const result: any[] = [];
  let next: string | null = url;
  for (let page = 0; next && page < 100; page++) {
    const parsed = new URL(next);
    const expected = provider === 'google' ? 'www.googleapis.com' : 'graph.microsoft.com';
    if (parsed.protocol !== 'https:' || parsed.host !== expected || parsed.username || parsed.password) throw new Error('Invalid calendar pagination URL.');
    const response: Response = await fetch(next, { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Calendar access was revoked. Connect again.' : 'Calendar could not sync. Please retry later.');
    const data: any = await response.json();
    result.push(...(provider === 'google' ? data.items ?? [] : data.value ?? []));
    if (result.length > 20000) throw new Error('Too many events. Choose fewer calendars or a shorter range.');
    if (provider === 'google' && data.nextPageToken) { const u = new URL(url); u.searchParams.set('pageToken', data.nextPageToken); next = u.href; }
    else next = provider === 'outlook' ? data['@odata.nextLink'] ?? null : null;
  }
  if (next) throw new Error('Calendar result is too large. Choose a shorter range.');
  return result;
}
async function sources(provider: CloudProvider, token: string): Promise<CalendarSource[]> {
  const rows = await pages(provider === 'google' ? 'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250' : 'https://graph.microsoft.com/v1.0/me/calendars?$top=100', token, provider);
  return rows.filter((r) => !r.deleted).map((r) => ({ id: r.id, provider, name: r.summaryOverride || r.summary || r.name || 'Calendar', color: r.backgroundColor || r.hexColor, account: r.owner?.address }));
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const url = new URL(req.url);
  if (req.method === 'GET' && url.searchParams.has('state')) {
    // The random state is single-use, expires, and is bound to the authenticated initiator.
    const { data: state, error } = await db.from('calendar_oauth_states').select().eq('state_hash', await hash(url.searchParams.get('state')!)).gt('expires_at', new Date().toISOString()).maybeSingle();
    if (error || !state) return json({ error: 'Calendar link expired. Return to VORA and connect again.' }, 400);
    const target = new URL(state.return_url);
    try {
      if (!url.searchParams.get('code') || url.searchParams.has('error')) throw new Error('Authorization declined.');
      const tokens = await exchange(state.provider, { grant_type: 'authorization_code', code: url.searchParams.get('code')!, redirect_uri: callback, code_verifier: state.verifier });
      if (!tokens.refresh_token) throw new Error('Offline access was not granted.');
      const { data: saved, error: saveError } = await db.rpc('complete_calendar_oauth', { p_state_hash: state.state_hash, p_tokens: await seal(tokens, `${state.user_id}:${state.provider}`) });
      if (saveError || !saved) throw new Error('Calendar link expired.');
      target.searchParams.set('calendar_result', 'connected');
    } catch {
      await db.from('calendar_oauth_states').delete().eq('state_hash', state.state_hash);
      target.searchParams.set('calendar_result', 'failed');
    }
    return new Response(null, { status: 303, headers: { Location: target.href, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const bearer = req.headers.get('Authorization')?.replace(/^Bearer /i, '');
  if (!bearer) return json({ error: 'Sign in to connect calendars.' }, 401);
  const { data: { user }, error: authError } = await db.auth.getUser(bearer);
  if (authError || !user) return json({ error: 'Sign in to connect calendars.' }, 401);
  try {
    const body = await req.json();
    if (body.action === 'status') {
      const { data, error } = await db.from('calendar_connections').select('provider').eq('user_id', user.id);
      if (error) throw error;
      return json({ connections: (['google', 'outlook'] as const).map(provider => ({ provider, ready: ready(provider), connected: data.some(row => row.provider === provider) })) });
    }
    const provider = providerOf(body.provider);
    if (body.action === 'disconnect') {
      // Cancels pending OAuth links too, so a late callback cannot reconnect.
      const { error: stateError } = await db.from('calendar_oauth_states').delete().eq('user_id', user.id).eq('provider', provider);
      if (stateError) throw stateError;
      const { error } = await db.from('calendar_connections').delete().eq('user_id', user.id).eq('provider', provider);
      if (error) throw error;
      return json({ ok: true });
    }
    if (!ready(provider)) return json({ error: 'Calendar connection is not configured on the server yet.' }, 503);
    if (body.action === 'connect') {
      const allowed = env('CALENDAR_RETURN_URLS').split(',').map(s => s.trim());
      if (typeof body.returnUrl !== 'string' || !allowed.includes(body.returnUrl)) throw new Error('This app URL is not enabled for calendar connections.');
      const state = random(), verifier = random();
      const { error: cleanup } = await db.from('calendar_oauth_states').delete().or(`expires_at.lt.${new Date().toISOString()},and(user_id.eq.${user.id},provider.eq.${provider})`);
      if (cleanup) throw cleanup;
      const { error } = await db.from('calendar_oauth_states').insert({ state_hash: await hash(state), user_id: user.id, provider, verifier, return_url: body.returnUrl, expires_at: new Date(Date.now() + 600000).toISOString() });
      if (error) throw error;
      const s = settings(provider), auth = new URL(s.authorize);
      auth.search = new URLSearchParams({ client_id: s.client_id, redirect_uri: callback, response_type: 'code', scope: s.scope, state, code_challenge: await hash(verifier), code_challenge_method: 'S256', ...(provider === 'google' ? { access_type: 'offline', prompt: 'consent' } : { prompt: 'select_account' }) }).toString();
      return json({ url: auth.href });
    }
    const token = await access(user.id, provider);
    const calendars = await sources(provider, token);
    if (body.action === 'calendars') return json({ calendars });
    if (body.action !== 'events') throw new Error('Unknown calendar action.');
    validRange(body.start, body.end);
    if (!Array.isArray(body.calendarIds) || body.calendarIds.length > 30 || body.calendarIds.some((id: unknown) => typeof id !== 'string' || !calendars.some(c => c.id === id))) throw new Error('Choose up to 30 accessible calendars.');
    const events: CalendarEvent[] = [];
    for (const id of [...new Set(body.calendarIds as string[])]) {
      const endpoint = provider === 'google'
        ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}/events?${new URLSearchParams({ timeMin: body.start, timeMax: body.end, singleEvents: 'true', maxResults: '2500', timeZone: 'Asia/Bangkok' })}`
        : `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(id)}/calendarView?${new URLSearchParams({ startDateTime: body.start, endDateTime: body.end, '$top': '1000' })}`;
      const rows = await pages(endpoint, token, provider);
      for (let row of rows) {
        // Preserve the source date of all-day events even when its timezone is
        // different from VORA's Bangkok display timezone. Graph otherwise returns UTC.
        if (provider === 'outlook' && row.isAllDay && row.originalStartTimeZone && row.originalStartTimeZone !== 'UTC') {
          const zone = String(row.originalStartTimeZone);
          if (/[\r\n"]/u.test(zone)) throw new Error('Calendar timezone is invalid.');
          const response = await fetch(`https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(id)}/events/${encodeURIComponent(row.id)}`, {
            headers: { Authorization: `Bearer ${token}`, Prefer: `outlook.timezone="${zone}"` }, signal: AbortSignal.timeout(20000),
          });
          if (!response.ok) throw new Error('Calendar all-day event could not sync.');
          row = await response.json();
        }
        const event = provider === 'google' ? googleEvent(row, id) : outlookEvent(row, id);
        if (event) events.push(event);
      }
    }
    return json({ events, calendars });
  } catch (e) {
    const message = e instanceof Error ? e.message : '';
    // Never expose provider responses, DB details, codes or credentials.
    const safe = /^(Choose|Calendar |Connect |This app URL|Too many|A calendar|Offline access|Unsupported)/.test(message);
    return json({ error: safe ? message : 'Calendar request failed. Please try again.' }, 400);
  }
});
