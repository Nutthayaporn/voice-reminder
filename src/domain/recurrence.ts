import type { Item } from '../store/types.ts';
const DAY = 86400000;
export const dateKey = (date: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(date));
const dayNumber = (date: Date | string) => Date.parse(`${dateKey(date)}T00:00:00+07:00`) / DAY;
export function occursOn(item: Item, day: Date): boolean {
  if (!item.start_at) return false;
  const first = dateKey(item.start_at), key = dateKey(day);
  if (key < first) return false;
  if (!item.recurrence) return item.end_at ? key <= dateKey(item.end_at) : key === first;
  const r = item.recurrence, interval = Math.max(1, Math.floor(r.interval));
  const delta = dayNumber(day) - dayNumber(item.start_at);
  const start = new Date(`${first}T00:00:00Z`), current = new Date(`${key}T00:00:00Z`);
  switch (r.freq) {
    case 'daily': return delta % interval === 0;
    case 'weekly': {
      const codes = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
      const weeks = Math.floor((delta + (start.getUTCDay() + 6) % 7) / 7);
      return weeks % interval === 0 && (r.byday?.length ? r.byday.includes(codes[current.getUTCDay()] as any) : current.getUTCDay() === start.getUTCDay());
    }
    case 'monthly': return current.getUTCDate() === start.getUTCDate() && ((current.getUTCFullYear() - start.getUTCFullYear()) * 12 + current.getUTCMonth() - start.getUTCMonth()) % interval === 0;
    case 'yearly': return key.slice(5) === first.slice(5) && (current.getUTCFullYear() - start.getUTCFullYear()) % interval === 0;
  }
}
export function occurrenceDates(item: Item, from: Date, to: Date, includeCompleted = false): Date[] {
  if (!item.start_at || item.done) return [];
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(item.start_at));
  const results: Date[] = [];
  const start = Date.parse(`${dateKey(from)}T00:00:00+07:00`);
  for (let value = start, n = 0; value <= to.getTime() && n < 3660; value += DAY, n++) {
    const day = new Date(value), key = dateKey(day);
    if (!occursOn(item, day) || (!includeCompleted && item.details?.occurrences?.[key])) continue;
    const instant = new Date(`${key}T${time}+07:00`);
    if (instant >= from && instant <= to) results.push(instant);
  }
  return results;
}
export function occurrencePatch(item: Item, key: string, status: 'done' | 'skipped' | 'pending'): Partial<Item> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !Number.isFinite(Date.parse(`${key}T12:00:00+07:00`)) || dateKey(`${key}T12:00:00+07:00`) !== key || !item.recurrence || !occursOn(item, new Date(`${key}T12:00:00+07:00`))) throw new Error('No occurrence on that date.');
  const occurrences = { ...item.details?.occurrences };
  if (status === 'pending') delete occurrences[key]; else occurrences[key] = status;
  return { done: false, details: { ...item.details, occurrences } };
}
