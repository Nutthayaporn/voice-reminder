// Convert a single BrainAction into a storable Item.
// Only the create_* tools map to items; record_expense/query do not.

import type { BrainAction } from './types';
import type { Item, ItemType } from '../store/types';

const TOOL_TO_TYPE: Record<string, ItemType> = {
  create_reminder: 'reminder',
  create_event: 'event',
  create_todo: 'todo',
  create_note: 'note',
};

/**
 * null when this action shouldn't be persisted (record_expense/query).
 * @param rawText the original spoken sentence, kept verbatim for memory recall.
 */
export function actionToItem(a: BrainAction, rawText?: string): Item | null {
  const type = TOOL_TO_TYPE[a.tool];
  if (!type) return null;

  const now = new Date().toISOString();
  return {
    id: makeId(),
    type,
    title: a.title,
    body: a.body,
    start_at: a.datetime,
    end_at: a.end_datetime,
    all_day: a.all_day,
    recurrence: a.recurrence,
    done: false,
    created_at: now,
    updated_at: now,
    notificationIds: [],
    raw_text: rawText,
    people: a.people ?? undefined,
  };
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}${Math.random().toString(36).slice(2, 4)}`;
}
