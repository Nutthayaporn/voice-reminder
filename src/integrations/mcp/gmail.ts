import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../../lib/supabase';
export interface GmailStatus { ready: boolean; connected: boolean }
export async function gmailApi<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('กรุณาเข้าสู่ระบบ VORA ก่อน');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('กรุณาเข้าสู่ระบบ VORA ก่อน');
  const response = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/gmail-api`, {
    method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(90000), redirect: 'error',
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Gmail connection failed (${response.status})`);
  const current = await supabase.auth.getSession();
  if (current.data.session?.user.id !== session.user.id) throw new Error('บัญชีเปลี่ยนแล้ว กรุณาลองใหม่');
  return result;
}
export async function connectGmail() {
  const returnUrl = Platform.OS === 'web' ? `${window.location.origin}${window.location.pathname}` : 'voicereminder://gmail/callback';
  const { url } = await gmailApi<{ url: string }>({ action: 'connect', returnUrl });
  const target = new URL(url);
  if (target.origin !== 'https://accounts.google.com' || target.pathname !== '/o/oauth2/v2/auth') throw new Error('Invalid Google authorization URL');
  if (Platform.OS === 'web') { window.location.assign(url); return; }
  const result = await WebBrowser.openAuthSessionAsync(url, returnUrl);
  if (result.type !== 'success') return;
  if (new URL(result.url).searchParams.get('gmail_result') !== 'connected') throw new Error('เชื่อม Gmail ไม่สำเร็จ กรุณาลองใหม่');
}
