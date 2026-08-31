// The one persisted record type. Everything the user captures — reminder,
// event, note — is an Item distinguished by `type` (decided with the owner: one
// table, no separate holidays table). Mirrors the planned Supabase `items`
// schema in docs/ARCHITECTURE.md so cloud sync later is a straight mapping.

import type { Recurrence } from '../brain/types';

export type ItemType = 'reminder' | 'event' | 'todo' | 'note';

export interface Item {
  id: string;
  type: ItemType;
  title: string;
  body: string | null;
  /** ISO 8601 (+07:00) — point in time / start. null for a note with no time. */
  start_at: string | null;
  /** ISO 8601 — end of a range (e.g. 1–2 Sep). */
  end_at: string | null;
  all_day: boolean;
  /** repeat rule; null = one-shot. */
  recurrence: Recurrence | null;
  done: boolean;
  created_at: string;
  /** ids returned by expo-notifications, kept so we can cancel on delete. */
  notificationIds: string[];

  // ── Memory layer (semantic recall) ──────────────────────────────────────
  /** The original spoken sentence, verbatim. Powers "what did I say" recall and
   *  keeps nuance the concise `title` drops. Optional (older rows lack it). */
  raw_text?: string;
  /** People mentioned ("ลูก", "แม่") — extracted by the brain for notes. */
  people?: string[];
}
