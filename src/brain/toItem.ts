// Convert a BrainResult (LLM interpretation) into a storable Item.
// Only the create_* intents map to items; query/add_expense/unknown do not.

import type { BrainResult } from './types';
import type { Item, ItemType } from '../store/types';

const INTENT_TO_TYPE: Record<string, ItemType> = {
  create_reminder: 'reminder',
  create_event: 'event',
  create_note: 'note',
};

/** null when this intent shouldn't be persisted (query/add_expense/unknown). */
export function brainToItem(b: BrainResult): Item | null {
  const type = INTENT_TO_TYPE[b.intent];
  if (!type) return null;

  return {
    id: makeId(),
    type,
    title: b.title,
    body: b.body,
    start_at: b.datetime,
    end_at: b.end_datetime,
    all_day: b.all_day,
    recurrence: b.recurrence,
    done: false,
    created_at: new Date().toISOString(),
    notificationIds: [],
  };
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
