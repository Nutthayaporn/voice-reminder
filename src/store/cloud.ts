// Supabase data gateway for items. Notification IDs deliberately never cross
// this boundary: each device creates and owns its local notification schedule.

import type { AlertMode, Recurrence, SnoozeMinutes } from '../brain/types';
import { supabase } from '../lib/supabase';
import type { Item, ItemType } from './types';

export interface CloudItemRow {
  id: string;
  details?: Item['details'];
  user_id: string;
  household_id: string | null;
  type: ItemType;
  title: string;
  body: string | null;
  start_at: string | null;
  end_at: string | null;
  all_day: boolean;
  recurrence: Recurrence | null;
  alert_mode: AlertMode;
  remind_until_done: boolean;
  snooze_minutes: SnoozeMinutes;
  max_attempts: number;
  people: string[] | null;
  raw_text: string | null;
  done: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function must() {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}

export function rowToItem(row: CloudItemRow): Item {
  return {
    id: row.id,
    details: row.details ?? {},
    household_id: row.household_id ?? null,
    type: row.type,
    title: row.title,
    body: row.body,
    start_at: row.start_at,
    end_at: row.end_at,
    all_day: row.all_day,
    recurrence: row.recurrence,
    alert_mode: row.remind_until_done ? 'alarm' : (row.alert_mode ?? 'notification'),
    remind_until_done: row.remind_until_done ?? false,
    snooze_minutes:
      row.snooze_minutes === 5 || row.snooze_minutes === 30 ? row.snooze_minutes : 10,
    max_attempts: row.max_attempts ?? 5,
    people: row.people ?? undefined,
    raw_text: row.raw_text ?? undefined,
    done: row.done,
    created_at: row.created_at,
    updated_at: row.updated_at,
    notificationIds: [],
  };
}

export async function fetchCloudItems(_userId: string): Promise<CloudItemRow[]> {
  const { data, error } = await must()
    .from('items')
    .select('*')
    .order('updated_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CloudItemRow[];
}

/** Conditional upsert enforced in SQL: an older offline edit cannot replace a newer row. */
export async function upsertCloudItem(item: Item): Promise<void> {
  const client = must();
  const args = {
    p_id: item.id,
    p_details: item.details ?? {},
    p_household_id: item.household_id ?? null,
    p_type: item.type,
    p_title: item.title,
    p_body: item.body,
    p_start_at: item.start_at,
    p_end_at: item.end_at,
    p_all_day: item.all_day,
    p_recurrence: item.recurrence,
    p_alert_mode: item.alert_mode,
    p_remind_until_done: item.remind_until_done,
    p_snooze_minutes: item.snooze_minutes,
    p_max_attempts: item.max_attempts,
    p_people: item.people ?? null,
    p_raw_text: item.raw_text ?? null,
    p_done: item.done,
    p_created_at: item.created_at,
    p_updated_at: item.updated_at,
  };
  let { error } = await client.rpc('upsert_item_lww', args);
  if (error?.code === 'PGRST202' && !Object.keys(item.details ?? {}).length) {
    const { p_details: _details, ...oldArgs } = args;
    ({ error } = await client.rpc('upsert_item_lww', oldArgs));
  }
  if (!error) return;

  // Keep personal sync working during the short deployment window before the
  // shared-households migration is applied. Shared items require the new RPC.
  if (error.code === 'PGRST202' && !item.household_id && !Object.keys(item.details ?? {}).length) {
    const { error: legacyError } = await client.rpc('upsert_item_lww', {
      p_id: item.id,
      p_type: item.type,
      p_title: item.title,
      p_body: item.body,
      p_start_at: item.start_at,
      p_end_at: item.end_at,
      p_all_day: item.all_day,
      p_recurrence: item.recurrence,
      p_alert_mode: item.alert_mode,
      p_remind_until_done: item.remind_until_done,
      p_snooze_minutes: item.snooze_minutes,
      p_max_attempts: item.max_attempts,
      p_people: item.people ?? null,
      p_raw_text: item.raw_text ?? null,
      p_done: item.done,
      p_created_at: item.created_at,
      p_updated_at: item.updated_at,
    });
    if (!legacyError) return;
    throw legacyError;
  }
  throw error;
}

/** Soft delete with the same LWW guard used by upserts. */
export async function deleteCloudItem(id: string, updatedAt: string): Promise<void> {
  const { error } = await must().rpc('delete_item_lww', {
    p_id: id,
    p_updated_at: updatedAt,
  });
  if (error) throw error;
}

export function subscribeCloudItems(userId: string, onChange: () => void): () => void {
  const sb = must();
  const channel = sb
    .channel(`voice-reminder:items:${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'items' },
      onChange,
    )
    .subscribe();

  return () => {
    void sb.removeChannel(channel);
  };
}
