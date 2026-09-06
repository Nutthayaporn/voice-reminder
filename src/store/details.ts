export type EntityKind = 'person' | 'pet' | 'place';
export interface ItemDetails {
  assigned_to?: string | null;
  notify_user_ids?: string[] | null;
  occurrences?: Record<string, 'done' | 'skipped'>;
  shopping?: { list: string; quantity: number; unit: string };
  profile?: { kind: EntityKind };
  entity_ids?: string[];
  parent_id?: string;
  reminder_offset_minutes?: number;
}
