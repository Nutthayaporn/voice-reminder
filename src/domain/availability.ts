import type { Item } from '../store/types';
import { occurrenceDates } from './recurrence.ts';
export interface TimeSlot { start: string; end: string }
export function busySlots(items: Item[], start: Date, end: Date): TimeSlot[] {
  return items.filter((i) => i.type === 'event' && !i.done && i.externalCalendar?.busy !== false).flatMap((i) => {
    if (!i.start_at) return [];
    const duration = i.end_at ? Date.parse(i.end_at) - Date.parse(i.start_at) : (i.all_day ? 86400000 : 3600000);
    if (!i.recurrence) return Date.parse(i.start_at) < end.getTime() && Date.parse(i.start_at) + duration > start.getTime() ? [{ start: i.start_at, end: new Date(Date.parse(i.start_at) + duration).toISOString() }] : [];
    return occurrenceDates(i, new Date(start.getTime() - Math.max(duration, 86400000)), end).filter((d) => d.getTime() < end.getTime() && d.getTime() + duration > start.getTime()).map((d) => ({ start: d.toISOString(), end: new Date(d.getTime() + duration).toISOString() }));
  }).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}
export function freeSlots(items: Item[], start: Date, end: Date, minutes: number): TimeSlot[] {
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || !Number.isFinite(minutes) || minutes <= 0 || end <= start || end.getTime() - start.getTime() > 31 * 86400000) throw new Error('Choose a valid time range of up to 31 days.');
  let cursor = start.getTime();
  const slots: TimeSlot[] = [];
  const add = (until: number) => { if (until - cursor >= minutes * 60000) slots.push({ start: new Date(cursor).toISOString(), end: new Date(until).toISOString() }); };
  for (const busy of busySlots(items, start, end)) { add(Math.min(Date.parse(busy.start), end.getTime())); cursor = Math.max(cursor, Date.parse(busy.end)); }
  add(end.getTime()); return slots;
}
