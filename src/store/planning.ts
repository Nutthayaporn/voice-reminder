import type { Item } from './types';
export function overdueItems(items: Item[], now = new Date()): Item[] {
  return items.filter((item) => !item.done && !item.recurrence && !item.details?.profile
    && (item.type === 'todo' || item.type === 'reminder') && item.start_at && Date.parse(item.start_at) < now.getTime()
    && (!item.all_day || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(item.start_at)) < new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(now)));
}
export function shoppingItems(items: Item[], list?: string | null): Item[] {
  return items.filter((item) => !item.done && item.details?.shopping && (!list || item.details.shopping.list.toLocaleLowerCase() === list.toLocaleLowerCase()));
}
export function shoppingDuplicate(items: Item[], item: Item): Item | undefined {
  const shopping = item.details?.shopping;
  if (!shopping) return;
  const matches = shoppingItems(items, shopping.list).filter((candidate) => candidate.title.trim().toLocaleLowerCase() === item.title.trim().toLocaleLowerCase()
    && candidate.details?.shopping?.unit === shopping.unit && (candidate.household_id ?? null) === (item.household_id ?? null));
  if (matches.length > 1) throw new Error('More than one shopping item matches. Select the item to edit.');
  return matches[0];
}
