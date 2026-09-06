import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import { Platform, Share } from 'react-native';

import { config } from '../config';

const PENDING_INVITE_KEY = 'voice-reminder/pending-household-invite';
const INVITE_CODE_PATTERN = /^[A-Z0-9]{8}$/;

export function normaliseInviteCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return INVITE_CODE_PATTERN.test(code) ? code : null;
}

function firstQueryValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Accept native, Expo Go, and web invite URL shapes. */
export function inviteCodeFromUrl(url: string): string | null {
  try {
    const parsed = Linking.parse(url);
    const fromQuery = firstQueryValue(
      parsed.queryParams?.code ?? parsed.queryParams?.invite,
    );
    const queryCode = normaliseInviteCode(fromQuery);
    if (queryCode) return queryCode;

    // Also accept /join/CODE so a future web landing page can use clean paths.
    const segments = [parsed.hostname, ...(parsed.path?.split('/') ?? [])].filter(Boolean);
    const joinIndex = segments.findIndex((segment) => segment?.toLowerCase() === 'join');
    return joinIndex >= 0 ? normaliseInviteCode(segments[joinIndex + 1]) : null;
  } catch {
    return null;
  }
}

export function createHouseholdInviteUrl(inviteCode: string): string {
  const code = normaliseInviteCode(inviteCode);
  if (!code) throw new Error('Invalid invite code.');

  if (config.sharing.inviteBaseUrl) {
    return `${config.sharing.inviteBaseUrl}/?invite=${encodeURIComponent(code)}`;
  }

  if (Platform.OS === 'web') {
    return Linking.createURL('', { queryParams: { invite: code } });
  }

  // In Expo Go this resolves to its exp:// development URL; in a development
  // or production build it resolves to voicereminder://join?code=….
  return Linking.createURL('join', { queryParams: { code } });
}

export async function shareHouseholdInvite(input: {
  name: string;
  inviteCode: string;
}): Promise<'shared' | 'copied'> {
  const url = createHouseholdInviteUrl(input.inviteCode);
  const message =
    `Join “${input.name}” on VORA.\n` +
    `Tap this link to open the invitation:\n${url}\n\n` +
    `Backup invite code: ${input.inviteCode}`;

  try {
    await Share.share(
      { title: `Join ${input.name} on VORA`, message, url },
      { dialogTitle: `Share invite to ${input.name}` },
    );
    return 'shared';
  } catch (error) {
    // Desktop browsers do not always implement Web Share. Copying preserves a
    // one-click fallback without adding clipboard permissions on native.
    if (
      Platform.OS === 'web' &&
      typeof navigator !== 'undefined' &&
      navigator.clipboard?.writeText
    ) {
      await navigator.clipboard.writeText(message);
      return 'copied';
    }
    throw error;
  }
}

export async function loadPendingHouseholdInvite(): Promise<string | null> {
  try {
    return normaliseInviteCode(await AsyncStorage.getItem(PENDING_INVITE_KEY));
  } catch {
    return null;
  }
}

export async function savePendingHouseholdInvite(inviteCode: string): Promise<void> {
  const code = normaliseInviteCode(inviteCode);
  if (!code) return;
  await AsyncStorage.setItem(PENDING_INVITE_KEY, code);
}

export async function clearPendingHouseholdInvite(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_INVITE_KEY);
}
