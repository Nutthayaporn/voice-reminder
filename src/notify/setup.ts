// Notification bootstrap: foreground handler, Android channel, permissions.
//
// expo-notifications needs a DEV BUILD (local scheduling is unreliable / warns
// in Expo Go on SDK 54+). Everything here is guarded so the app still runs and
// persists items in Expo Go — only the actual alarm won't fire there.

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

let initialised = false;

export async function initNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;
  if (initialised) return;
  initialised = true;

  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'การเตือน',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
      });
    }
  } catch {
    /* native module unavailable (Expo Go) — ignore */
  }
}

/** Request permission to post notifications. Returns whether granted. */
export async function ensureNotifyPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const req = await Notifications.requestPermissionsAsync();
    return req.granted;
  } catch {
    return false;
  }
}
