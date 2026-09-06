import type { BrainAction } from '../brain/types';
import type { Item } from '../store/types';

export interface SpaceRef { id: string; name: string; aliases?: string[] }
export const PERSONAL_SPACE = 'personal';

/** Names are user data. IDs, never guessed names, are persisted on records. */
export function resolveSpace(
  action: Pick<BrainAction, 'space_ref' | 'space_name'>,
  selected: string | null,
  spaces: SpaceRef[],
): string | null {
  const ref = action.space_ref ?? selected ?? PERSONAL_SPACE;
  if (ref === PERSONAL_SPACE) {
    if (action.space_name) throw new Error('Please choose the named shared space explicitly.');
    return null;
  }
  const space = spaces.find((candidate) => candidate.id === ref);
  if (!space) throw new Error('Please select an available space before continuing.');
  if (action.space_name) {
    const matches = spaces.filter((candidate) => [candidate.name, ...(candidate.aliases ?? [])].some((name) => name.trim().toLocaleLowerCase() === action.space_name!.trim().toLocaleLowerCase()));
    if (matches.length !== 1 || matches[0].id !== ref) {
      throw new Error('That space name is ambiguous. Please select the space above the microphone.');
    }
  }
  return space.id;
}

export function itemsInSpace(items: Item[], spaceId: string | null): Item[] {
  return items.filter((item) => (item.household_id ?? null) === spaceId);
}

export function spaceLabel(spaceId: string | null | undefined, spaces: SpaceRef[]): string {
  return spaceId ? spaces.find((space) => space.id === spaceId)?.name ?? 'Shared space' : 'Only me';
}
