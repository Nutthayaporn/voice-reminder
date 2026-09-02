// OAuth 2.0 client (Authorization Code + PKCE) for connecting THIS user's
// daily-budget account, so budget-api calls act on their own data.
//
// Flow (see daily-budget: app/connect.tsx + functions/oauth-token):
//   1. connect() builds `dailybudget://connect?...` and opens the daily-budget
//      app, where the user signs in + consents.
//   2. daily-budget redirects back to `voicereminder://budget-oauth?code=...`.
//   3. We exchange the code (+ PKCE verifier) at the oauth-token endpoint for an
//      access JWT + refresh token, stored locally.
//   4. getAccessToken() returns a valid access token, refreshing as needed.
//
// Tokens live in AsyncStorage (consistent with the app's Supabase session).
// Move to expo-secure-store for extra hardening before a public release.

import { Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

import { config, budgetFunctionUrl } from '../config';

const STORAGE_KEY = 'budget_oauth_tokens_v1';
const CALLBACK_TIMEOUT_MS = 120_000;

interface StoredTokens {
  access_token: string;
  /** epoch ms when the access token expires */
  access_expires_at: number;
  refresh_token: string;
  scope: string;
}

// ── base64url + PKCE ─────────────────────────────────────────────────────────
function toBase64Url(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  // btoa exists in RN via the URL polyfill / Hermes global.
  return btoa(bin);
}
async function makeVerifier(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  return toBase64Url(bytesToBase64(bytes));
}
async function challengeFor(verifier: string): Promise<string> {
  const b64 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  return toBase64Url(b64);
}
function randomState(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

// ── token storage ────────────────────────────────────────────────────────────
async function loadTokens(): Promise<StoredTokens | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredTokens) : null;
  } catch {
    return null;
  }
}
async function saveTokens(t: StoredTokens): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(t));
}
async function clearTokens(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  error?: string;
  error_description?: string;
}

async function postToken(body: Record<string, string>): Promise<StoredTokens> {
  const res = await fetch(budgetFunctionUrl('oauth-token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || data.error || !data.access_token) {
    throw new Error(`oauth_token ${res.status} ${data.error ?? ''} ${data.error_description ?? ''}`.trim());
  }
  return {
    access_token: data.access_token,
    access_expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
    refresh_token: data.refresh_token,
    scope: data.scope ?? config.budgetOAuth.scopes,
  };
}

// ── the interactive connect (authorization request) ──────────────────────────
/** Open daily-budget's consent screen and wait for the redirect back. */
function awaitCallback(expectedState: string): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      sub.remove();
      clearTimeout(timer);
      fn();
    };
    const handle = (url: string) => {
      if (!url.startsWith(config.budgetOAuth.redirectUri)) return;
      const parsed = new URL(url);
      const params = new URLSearchParams(parsed.search);
      if (params.get('state') !== expectedState) {
        finish(() => reject(new Error('state_mismatch')));
        return;
      }
      const err = params.get('error');
      if (err) {
        finish(() => reject(new Error(err)));
        return;
      }
      finish(() => resolve(params));
    };
    const sub = Linking.addEventListener('url', (e) => handle(e.url));
    const timer = setTimeout(() => finish(() => reject(new Error('timeout'))), CALLBACK_TIMEOUT_MS);
  });
}

export interface ConnectResult {
  ok: boolean;
  /** cancelled / timeout / provider-missing / error detail */
  reason?: string;
}

/** Run the full authorization-code + PKCE flow. Resolves once tokens are saved. */
export async function connect(): Promise<ConnectResult> {
  if (!isBudgetOAuthConfigured()) return { ok: false, reason: 'not_configured' };

  const verifier = await makeVerifier();
  const challenge = await challengeFor(verifier);
  const state = randomState();

  const authorizeUrl =
    `${config.budgetOAuth.providerScheme}://connect?response_type=code` +
    `&client_id=${encodeURIComponent(config.budgetOAuth.clientId)}` +
    `&redirect_uri=${encodeURIComponent(config.budgetOAuth.redirectUri)}` +
    `&scope=${encodeURIComponent(config.budgetOAuth.scopes)}` +
    `&state=${encodeURIComponent(state)}` +
    `&code_challenge=${encodeURIComponent(challenge)}` +
    `&code_challenge_method=S256`;

  const callback = awaitCallback(state);
  try {
    await Linking.openURL(authorizeUrl);
  } catch {
    return { ok: false, reason: 'provider_missing' };
  }

  let params: URLSearchParams;
  try {
    params = await callback;
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }

  const code = params.get('code');
  if (!code) return { ok: false, reason: 'no_code' };

  try {
    const tokens = await postToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.budgetOAuth.redirectUri,
      client_id: config.budgetOAuth.clientId,
      code_verifier: verifier,
    });
    await saveTokens(tokens);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/** Revoke the refresh token server-side and forget it locally. */
export async function disconnect(): Promise<void> {
  const tokens = await loadTokens();
  if (tokens?.refresh_token) {
    await fetch(budgetFunctionUrl('oauth-revoke'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tokens.refresh_token }),
    }).catch(() => undefined);
  }
  await clearTokens();
}

/** A valid access token, refreshing if needed. null = not connected / failed. */
export async function getAccessToken(): Promise<string | null> {
  const tokens = await loadTokens();
  if (!tokens) return null;

  // Refresh a little early to avoid edge-of-expiry failures.
  if (tokens.access_expires_at - 60_000 > Date.now()) return tokens.access_token;

  try {
    const refreshed = await postToken({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: config.budgetOAuth.clientId,
    });
    await saveTokens(refreshed);
    return refreshed.access_token;
  } catch {
    // Refresh failed (revoked/expired) — drop the dead session.
    await clearTokens();
    return null;
  }
}

export async function isConnected(): Promise<boolean> {
  return (await loadTokens()) !== null;
}

export function isBudgetOAuthConfigured(): boolean {
  return config.budgetApi.url.length > 0;
}
