import { dateKey } from '../domain/recurrence.ts';
import type { Item } from './types';
/** Links never cross visibility boundaries. A parent can have many reminders. */
export function linkedChildren(items: Item[], parent: Item): Item[] {
  return items.filter((item) => item.details?.parent_id === parent.id && (item.household_id ?? null) === (parent.household_id ?? null));
}
export function linkedPatches(items: Item[], parent: Item, patch: Partial<Item>): Array<{ id: string; patch: Partial<Item> }> {
  if (patch.start_at === undefined && patch.done === undefined && patch.household_id === undefined && patch.details?.occurrences === undefined) return [];
  return linkedChildren(items, parent).map((child) => {
    const next: Partial<Item> = {};
    if (patch.start_at && parent.start_at && child.start_at) {
      const offset = child.details?.reminder_offset_minutes ?? (Date.parse(child.start_at) - Date.parse(parent.start_at)) / 60000;
      next.start_at = new Date(Date.parse(patch.start_at) + offset * 60000).toISOString();
    }
    if (patch.done !== undefined) next.done = patch.done;
    if (patch.details?.occurrences && parent.start_at && child.start_at) {
      const offset = Date.parse(child.start_at) - Date.parse(parent.start_at);
      const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(parent.start_at));
      const occurrences = { ...child.details?.occurrences };
      for (const key of new Set([...Object.keys(parent.details?.occurrences ?? {}), ...Object.keys(patch.details.occurrences)])) {
        if (parent.details?.occurrences?.[key] === patch.details.occurrences[key]) continue;
        const childKey = dateKey(new Date(Date.parse(`${key}T${time}+07:00`) + offset));
        const status = patch.details.occurrences[key];
        if (status) occurrences[childKey] = status; else delete occurrences[childKey];
      }
      next.details = { ...child.details, occurrences };
    }
    if (patch.household_id !== undefined) {
      next.household_id = patch.household_id;
      next.raw_text = [child.title, child.body].filter(Boolean).join('. ');
      next.details = { ...child.details, entity_ids: [] };
    }
    return { id: child.id, patch: next };
  });
}

/** Validate links for the whole plan before creating even the first item. */
export function validatePlanLinks(
  actions: import('../brain/types').BrainAction[],
  items: Item[],
  spaceFor: (action: import('../brain/types').BrainAction) => string | null,
): void {
  actions.forEach((action, index) => {
    if (!action.parent_ref) return;
    if (action.tool !== 'create_reminder' || !action.datetime || !Number.isFinite(Date.parse(action.datetime))) throw new Error('A linked reminder needs a valid date and time.');
    const match = action.parent_ref.match(/^action:(\d+)$/);
    if (match) {
      const parentIndex = Number(match[1]) - 1;
      const parent = actions[parentIndex];
      if (parentIndex >= index || !parent || !['create_event', 'create_todo'].includes(parent.tool)
        || !parent.datetime || !Number.isFinite(Date.parse(parent.datetime)) || spaceFor(parent) !== spaceFor(action)) {
        throw new Error('Create the dated event or task before its reminder, in the same space.');
      }
    } else {
      const parent = items.find((item) => item.id === action.parent_ref);
      if (!parent || !['event', 'todo'].includes(parent.type) || !parent.start_at
        || !Number.isFinite(Date.parse(parent.start_at)) || (parent.household_id ?? null) !== spaceFor(action)) {
        throw new Error('The linked event or task is not available in this space.');
      }
    }
  });
}
