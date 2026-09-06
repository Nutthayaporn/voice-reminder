// Web Push delivery is scheduled server-side from synced items.
// Browser subscriptions are managed separately in webPush.web.ts.

import type { Item } from '../store/types';

export async function scheduleForItem(_item: Item): Promise<string[]> {
  return [];
}

export async function cancelNotifications(_ids: string[]): Promise<void> {}
