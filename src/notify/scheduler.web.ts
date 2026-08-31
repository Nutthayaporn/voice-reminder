// Web Push requires a separate service-worker/push subscription flow. Items
// still save locally on web; scheduling remains a native-only capability.

import type { Item } from '../store/types';

export async function scheduleForItem(_item: Item): Promise<string[]> {
  return [];
}

export async function cancelNotifications(_ids: string[]): Promise<void> {}
