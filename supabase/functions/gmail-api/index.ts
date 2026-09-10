import { createClient } from 'npm:@supabase/supabase-js@2';
import { gmailMcp, isGmailReadTool } from './mcp.ts';
type CloudProvider = 'google';
const env = (name: string) => Deno.env.get(name) ?? '';
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
const callback = `${env('SUPABASE_URL')}/functions/v1/gmail-api`;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Cache-Control': 'no-store' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const random = () => b64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hash = async (value: string) => b64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function key() { return crypto.subtle.importKey('raw', unb64(env('GMAIL_TOKEN_KEY')), 'AES-GCM', false, ['encrypt', 'decrypt']); }
async function seal(value: unknown, owner: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(owner) }, await key(), new TextEncoder().encode(JSON.stringify(value)));
  return `${b64(iv)}.${b64(new Uint8Array(encrypted))}`;
}
async function unseal(value: string, owner: string) {
  const [iv, data] = value.split('.');
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: new TextEncoder().encode(owner) }, await key(), unb64(data))));
}
function settings(_provider: CloudProvider) {
  return { client_id: env('GOOGLE_GMAIL_CLIENT_ID'), client_secret: env('GOOGLE_GMAIL_CLIENT_SECRET'),
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/gmail.readonly' };
}
function ready(provider: CloudProvider) { const s = settings(provider); return !!(s.client_id && s.client_secret && env('GMAIL_TOKEN_KEY') && env('GMAIL_RETURN_URLS')); }
function providerOf(value: unknown): CloudProvider {
  if (value !== 'google') throw new Error('Unsupported calendar provider.');
  return value;
}
async function exchange(provider: CloudProvider, fields: Record<string, string>) {
  const s = settings(provider);
  const response = await fetch(s.token, { method: 'POST', body: new URLSearchParams({ client_id: s.client_id, client_secret: s.client_secret, ...fields }), signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (!response.ok) throw new Error('Gmail authorization expired or was declined. Connect again.');
  const tokens = await response.json();
  if (!tokens.access_token || !tokens.expires_in) throw new Error('Gmail authorization failed.');
  return { ...tokens, expires_at: Date.now() + tokens.expires_in * 1000 };
}
async function access(user: string, provider: CloudProvider) {
  const { data, error } = await db.from('gmail_connections').select('tokens').eq('user_id', user).eq('provider', provider).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Connect Gmail first.');
  const tokens = await unseal(data.tokens, `${user}:${provider}`);
  if (tokens.expires_at > Date.now() + 60000) return tokens.access_token as string;
  const next = await exchange(provider, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
  next.refresh_token ||= tokens.refresh_token;
  const { error: saveError } = await db.from('gmail_connections').update({ tokens: await seal(next, `${user}:${provider}`), updated_at: new Date().toISOString() }).eq('user_id', user).eq('provider', provider).eq('tokens', data.tokens);
  if (saveError) throw saveError;
  return next.access_token as string;
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const url = new URL(req.url);
  if (req.method === 'GET' && url.searchParams.has('state')) {
    // The random state is single-use, expires, and is bound to the authenticated initiator.
    const { data: state, error } = await db.from('gmail_oauth_states').select().eq('state_hash', await hash(url.searchParams.get('state')!)).gt('expires_at', new Date().toISOString()).maybeSingle();
    if (error || !state) return json({ error: 'Gmail link expired. Return to VORA and connect again.' }, 400);
    const target = new URL(state.return_url);
    try {
      if (!url.searchParams.get('code') || url.searchParams.has('error')) throw new Error('Authorization declined.');
      const tokens = await exchange(state.provider, { grant_type: 'authorization_code', code: url.searchParams.get('code')!, redirect_uri: callback, code_verifier: state.verifier });
      if (!tokens.refresh_token) throw new Error('Offline access was not granted.');
      const { data: saved, error: saveError } = await db.rpc('complete_gmail_oauth', { p_state_hash: state.state_hash, p_tokens: await seal(tokens, `${state.user_id}:${state.provider}`) });
      if (saveError || !saved) throw new Error('Gmail link expired.');
      target.searchParams.set('gmail_result', 'connected');
    } catch {
      await db.from('gmail_oauth_states').delete().eq('state_hash', state.state_hash);
      target.searchParams.set('gmail_result', 'failed');
    }
    return new Response(null, { status: 303, headers: { Location: target.href, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const bearer = req.headers.get('Authorization')?.replace(/^Bearer /i, '');
  if (!bearer) return json({ error: 'Sign in to connect Gmail.' }, 401);
  const { data: { user }, error: authError } = await db.auth.getUser(bearer);
  if (authError || !user) return json({ error: 'Sign in to connect Gmail.' }, 401);
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid request.' }, 400);
    if (body.action === 'status') {
      const { data, error } = await db.from('gmail_connections').select('provider').eq('user_id', user.id);
      if (error) throw error;
      return json({ connections: (['google'] as const).map(provider => ({ provider, ready: ready(provider), connected: data.some(row => row.provider === provider) })) });
    }
    const provider = providerOf(body.provider ?? 'google');
    if (body.action === 'disconnect') {
      // Cancels pending OAuth links too, so a late callback cannot reconnect.
      const { error: stateError } = await db.from('gmail_oauth_states').delete().eq('user_id', user.id).eq('provider', provider);
      if (stateError) throw stateError;
      const { error } = await db.from('gmail_connections').delete().eq('user_id', user.id).eq('provider', provider);
      if (error) throw error;
      return json({ ok: true });
    }
    if (!ready(provider)) return json({ error: 'Gmail connection is not configured on the server yet.' }, 503);
    if (body.action === 'connect') {
      const allowed = env('GMAIL_RETURN_URLS').split(',').map(s => s.trim());
      if (typeof body.returnUrl !== 'string' || !allowed.includes(body.returnUrl)) throw new Error('This app URL is not enabled for Gmail connections.');
      const state = random(), verifier = random();
      const { error: cleanup } = await db.from('gmail_oauth_states').delete().or(`expires_at.lt.${new Date().toISOString()},and(user_id.eq.${user.id},provider.eq.${provider})`);
      if (cleanup) throw cleanup;
      const { error } = await db.from('gmail_oauth_states').insert({ state_hash: await hash(state), user_id: user.id, provider, verifier, return_url: body.returnUrl, expires_at: new Date(Date.now() + 600000).toISOString() });
      if (error) throw error;
      const s = settings(provider), auth = new URL(s.authorize);
      auth.search = new URLSearchParams({ client_id: s.client_id, redirect_uri: callback, response_type: 'code', scope: s.scope, state, code_challenge: await hash(verifier), code_challenge_method: 'S256', ...(provider === 'google' ? { access_type: 'offline', prompt: 'consent' } : { prompt: 'select_account' }) }).toString();
      return json({ url: auth.href });
    }
    if (!['tools', 'call'].includes(body.action)) return json({ error: 'Unknown Gmail action.' }, 400);
    if (body.action === 'call' && (typeof body.name !== 'string' || !isGmailReadTool(body.name) || !body.arguments || typeof body.arguments !== 'object' || Array.isArray(body.arguments) || JSON.stringify(body.arguments).length > 8000)) return json({ error: 'Invalid Gmail read tool.' }, 400);
    const token = await access(user.id, provider);
    try { return json(await gmailMcp(token, body.action === 'call' ? { name: body.name, arguments: body.arguments } : undefined)); }
    catch { return json({ error: 'Gmail MCP unavailable. Check Developer Preview access, Gmail MCP API, and reconnect Google.' }, 502); }
  } catch {
    return json({ error: 'Gmail request failed. Check server configuration or reconnect your account.' }, 400);
  }
});
