import type { Item } from '../store/types';
import type { EntityKind } from '../store/details';
export function entityContext(items: Item[], aliases: Record<string, string[]> = {}) {
  return items.filter((item) => item.details?.profile).map((item) => ({
    id: item.id, name: item.title, kind: item.details!.profile!.kind,
    space_id: item.household_id ?? 'personal', aliases: aliases[item.id] ?? [], description: item.body,
  }));
}
export function validateEntityLinks(ids: string[] | null | undefined, spaceId: string | null, items: Item[]): string[] {
  const unique = [...new Set(ids ?? [])];
  if (unique.some((id) => !items.some((item) => item.id === id && item.details?.profile && (item.household_id ?? null) === spaceId))) {
    throw new Error('A person, pet or place is not available in this space. Add it here first.');
  }
  return unique;
}
export function entityKind(value: unknown): EntityKind | null {
  return value === 'person' || value === 'pet' || value === 'place' ? value : null;
}
