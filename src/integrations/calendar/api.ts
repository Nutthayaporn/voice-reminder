import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../../lib/supabase';
import type { CloudProvider } from './model';
export async function calendarApi<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Sign in to VORA before connecting Google or Outlook.');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sign in to VORA before connecting Google or Outlook.');
  const response = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/calendar-api`, {
    method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(90000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Calendar service is unavailable. Please retry later.');
  const current = await supabase.auth.getSession();
  if (current.data.session?.user.id !== session.user.id) throw new Error('Account changed. Please try again.');
  return data;
}
export async function connectCloud(provider: CloudProvider) {
  const returnUrl = Platform.OS === 'web' ? `${window.location.origin}${window.location.pathname}` : 'voicereminder://calendar/callback';
  const { url } = await calendarApi<{ url: string }>({ action: 'connect', provider, returnUrl });
  if (Platform.OS === 'web') { window.location.assign(url); return; }
  const result = await WebBrowser.openAuthSessionAsync(url, returnUrl);
  if (result.type !== 'success') return;
  if (new URL(result.url).searchParams.get('calendar_result') !== 'connected') throw new Error('Calendar connection was not completed. Try again.');
}
