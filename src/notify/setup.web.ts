// Web notifications are intentionally out of scope for the first PWA phase.
// Keeping this platform file import-free prevents expo-notifications from
// initialising (and warning) in the browser while preserving the native API.

export async function initNotifications(): Promise<void> {}

export async function ensureNotifyPermission(): Promise<boolean> {
  return false;
}
