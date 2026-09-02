import { makeRedirectUri } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import type { Provider } from '@supabase/supabase-js';

import { supabase } from './supabase';

export type SocialAuthProvider = Extract<Provider, 'google' | 'facebook'>;

type AuthResult = {
  error?: string;
  cancelled?: boolean;
};

function oauthRedirectUrl(): string {
  if (Platform.OS === 'web') return makeRedirectUri();

  return makeRedirectUri({
    scheme: 'voicereminder',
    path: 'auth/callback',
  });
}

function callbackParams(url: string): URLSearchParams {
  const parsed = new URL(url);
  const params = new URLSearchParams(parsed.search);
  const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  hashParams.forEach((value, key) => params.set(key, value));
  return params;
}

async function createSessionFromCallback(url: string): Promise<AuthResult> {
  if (!supabase) return { error: 'Supabase is not configured.' };

  const params = callbackParams(url);
  const oauthError = params.get('error_description') || params.get('error');
  if (oauthError) return { error: oauthError };

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    return error ? { error: error.message } : {};
  }

  // Also accept a PKCE callback if the Supabase project changes flow type later.
  const code = params.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return error ? { error: error.message } : {};
  }

  return { error: 'The provider did not return a valid sign-in session.' };
}

export async function signInWithSocialProvider(
  provider: SocialAuthProvider,
): Promise<AuthResult> {
  if (!supabase) return { error: 'Supabase is not configured.' };

  const redirectTo = oauthRedirectUrl();

  // On web, Supabase performs a full-page redirect. This avoids popup blockers,
  // especially on mobile browsers. detectSessionInUrl restores the session when
  // the provider returns to this same URL.
  if (Platform.OS === 'web') {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo },
    });
    return error ? { error: error.message } : {};
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });
  if (error) return { error: error.message };
  if (!data.url) return { error: 'The provider did not return a sign-in URL.' };

  const browserResult = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (browserResult.type !== 'success') return { cancelled: true };

  return createSessionFromCallback(browserResult.url);
}
