// On-device STT via expo-speech-recognition.
//
// This is a native module and is NOT bundled into Expo Go — it only exists in a
// dev build (`npx expo run:ios` / `run:android` or an EAS dev-client build).
//
// IMPORTANT: we must NOT statically `import ... from 'expo-speech-recognition'`,
// because that package calls `requireNativeModule('ExpoSpeechRecognition')` at
// load time, which THROWS in Expo Go and crashes the whole app (even the cloud
// path). Instead we grab the native module optionally — it returns null when
// absent — so the app runs fine in Expo Go with only the cloud engine enabled.

import { requireOptionalNativeModule } from 'expo';
import type { EventSubscription } from 'expo-modules-core';

// null in Expo Go / web; the real module in a dev build.
const nativeModule = requireOptionalNativeModule<any>('ExpoSpeechRecognition');

/** The raw native module, or null when unavailable. */
export function getSpeechModule(): any | null {
  return nativeModule;
}

/** True when on-device recognition can actually run in this binary. */
export function isDeviceSttAvailable(): boolean {
  try {
    return !!nativeModule && nativeModule.isRecognitionAvailable();
  } catch {
    return false;
  }
}

/** Ask for mic + speech-recognition permission. Returns whether granted. */
export async function ensureDeviceSttPermission(): Promise<boolean> {
  if (!nativeModule) return false;
  try {
    const res = await nativeModule.requestPermissionsAsync();
    return !!res?.granted;
  } catch {
    return false;
  }
}

/** Subscribe to a native recognition event; no-op (returns null) if unavailable. */
export function addSpeechListener(
  event: 'result' | 'error' | 'end',
  listener: (payload: any) => void,
): EventSubscription | null {
  if (!nativeModule) return null;
  try {
    return nativeModule.addListener(event, listener);
  } catch {
    return null;
  }
}
