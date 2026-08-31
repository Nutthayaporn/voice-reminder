// Supabase data gateway for items. Notification IDs deliberately never cross
// this boundary: each device creates and owns its local notification schedule.

import type { Recurrence } from '../brain/types';
import { supabase } from '../lib/supabase';
import type { Item, ItemType } from './types';

export interface CloudItemRow {
  id: string;
  user_id: string;
  type: ItemType;
  title: string;
  body: string | null;
  start_at: string | null;
  end_at: string | null;
  all_day: boolean;
  recurrence: Recurrence | null;
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
    type: row.type,
    title: row.title,
    body: row.body,
    start_at: row.start_at,
    end_at: row.end_at,
    all_day: row.all_day,
    recurrence: row.recurrence,
    people: row.people ?? undefined,
    raw_text: row.raw_text ?? undefined,
    done: row.done,
    created_at: row.created_at,
    updated_at: row.updated_at,
    notificationIds: [],
  };
}

export async function fetchCloudItems(userId: string): Promise<CloudItemRow[]> {
  const { data, error } = await must()
    .from('items')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CloudItemRow[];
}

/** Conditional upsert enforced in SQL: an older offline edit cannot replace a newer row. */
export async function upsertCloudItem(item: Item): Promise<void> {
  const { error } = await must().rpc('upsert_item_lww', {
    p_id: item.id,
    p_type: item.type,
    p_title: item.title,
    p_body: item.body,
    p_start_at: item.start_at,
    p_end_at: item.end_at,
    p_all_day: item.all_day,
    p_recurrence: item.recurrence,
    p_people: item.people ?? null,
    p_raw_text: item.raw_text ?? null,
    p_done: item.done,
    p_created_at: item.created_at,
    p_updated_at: item.updated_at,
  });
  if (error) throw error;
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
      { event: '*', schema: 'public', table: 'items', filter: `user_id=eq.${userId}` },
      onChange,
    )
    .subscribe();

  return () => {
    void sb.removeChannel(channel);
  };
}
