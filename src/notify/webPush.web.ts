import { supabase } from '../lib/supabase';
const endpoint = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/web-push`;
export const pushSupported = () => typeof window !== 'undefined' && window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
async function registration() {
  await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}
export async function pushEnabled() {
  if (!pushSupported() || !supabase) return false;
  const subscription = await (await registration()).pushManager.getSubscription();
  if (!subscription) return false;
  const { data, error } = await supabase.from('web_push_subscriptions').select('id').eq('endpoint', subscription.endpoint).maybeSingle();
  if (error) throw error;
  return !!data;
}
export async function enableWebPush() {
  if (!pushSupported() || !supabase) throw new Error('Use a supported browser over HTTPS. On iPhone, add VORA to the Home Screen first.');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in before enabling Web Push.');
  if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications are blocked. Allow them in browser settings.');
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY}` } });
  if (!response.ok) throw new Error('Web Push server is not configured.');
  const { publicKey } = await response.json();
  const base64 = publicKey.replace(/-/g, '+').replace(/_/g, '/');
  const key = Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
  const worker = await registration();
  let subscription = await worker.pushManager.getSubscription();
  // A stale subscription can belong to an earlier signed-in account. Rotate it
  // before registering rather than moving another account's row.
  if (subscription && !await pushEnabled()) { await subscription.unsubscribe(); subscription = null; }
  subscription ??= await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const { error } = await supabase.from('web_push_subscriptions').upsert({ user_id: user.id, endpoint: subscription.endpoint, keys: subscription.toJSON().keys }, { onConflict: 'endpoint' });
  if (error) { await subscription.unsubscribe(); throw error; }
}
export async function disableWebPush() {
  if (!pushSupported()) return;
  const subscription = await (await registration()).pushManager.getSubscription();
  if (!subscription) return;
  // Unsubscribe first so even an offline sign-out cannot receive old pushes.
  await subscription.unsubscribe();
  const { error } = await supabase!.from('web_push_subscriptions').delete().eq('endpoint', subscription.endpoint);
  if (error) throw error;
}
export async function testWebPush() {
  const { data } = await supabase!.auth.getSession();
  const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${data.session?.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ test: true }) });
  if (!response.ok) throw new Error('Test notification could not be sent. Please retry later.');
}
