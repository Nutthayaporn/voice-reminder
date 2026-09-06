// Answers a `query` intent by reading the local store and composing a spoken
// reply. Phase 2 handles the common cases (today / this week); richer
// natural-language search can grow here later.

import { occursOn, dateKey } from '../domain/recurrence.ts';
import { overdueItems, shoppingItems } from './planning.ts';
import type { BrainAction } from '../brain/types';
import type { Item } from './types';

const TZ = 'Asia/Bangkok';

function bkkDateStr(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  // en-CA gives YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

function bkkWeekdayCode(d: Date): string {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(d);
  const map: Record<string, string> = {
    Sun: 'SU', Mon: 'MO', Tue: 'TU', Wed: 'WE', Thu: 'TH', Fri: 'FR', Sat: 'SA',
  };
  return map[wd] ?? 'MO';
}

function timeLabel(iso: string | null, allDay: boolean, language: 'th' | 'en' = 'en'): string {
  if (!iso || allDay) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((value) => value.type === type)?.value ?? 0);
  const hour24 = part('hour');
  const minute = part('minute');
  if (language === 'th') return ` เวลา ${hour24}:${String(minute).padStart(2, '0')} นาฬิกา`;
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour = hour24 % 12 || 12;
  return minute === 0 ? ` at ${hour} ${period}` : ` at ${hour} ${minute} ${period}`;
}

/** Does this item occur on `day` (a Bangkok calendar date)? */
/** Speech-friendly date+time label with no abbreviations. */
function dayTimeLabel(iso: string | null, allDay: boolean, language: 'th' | 'en' = 'en'): string {
  if (!iso) return '';
  const date = new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-US', {
    timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date(iso));
  return allDay ? `, ${date}` : `, ${date}${timeLabel(iso, false, language)}`;
}

/** The ordered set of items relevant "today" — dated occurrences + standing
 *  todos. Shared by the spoken answer and the multi-turn referent list so
 *  "อันแรก" points at exactly what was read out. */
export function todayItems(items: Item[], now: Date = new Date()): Item[] {
  const dated = items.filter((i) => !i.done && !i.details?.occurrences?.[dateKey(now)] && occursOn(i, now));
  const undatedTodos = items.filter((i) => !i.done && i.type === 'todo' && !i.start_at);
  return [...dated, ...undatedTodos].sort((a, b) =>
    (a.start_at ?? '9999').localeCompare(b.start_at ?? '9999'),
  );
}

/** Items occurring on any day within [start, end] (inclusive). Iterates day by
 *  day so recurring rules are honoured; deduped by id. */
export function itemsInRange(items: Item[], start: Date, end: Date): Item[] {
  const out = new Map<string, Item>();
  const first = Date.parse(`${dateKey(start)}T00:00:00+07:00`);
  for (let value = first, guard = 0; value <= end.getTime() && guard < 3660; value += 86400000, guard++) {
    const day = new Date(value);
    for (const i of items) {
      if (!i.done && !i.details?.occurrences?.[dateKey(day)] && occursOn(i, day)) out.set(i.id, i);
    }
  }
  return [...out.values()].sort((a, b) =>
    (a.start_at ?? '9999').localeCompare(b.start_at ?? '9999'),
  );
}

/** True when the action asks about a date range the brain already resolved. */
function isRangeQuery(action: BrainAction): boolean {
  return action.query_kind === 'list_range' && !!action.datetime;
}

/** The item set a query action refers to — shared by the answer and the
 *  multi-turn referent list so "อันแรก" matches what was read out. */
export function queryItems(items: Item[], action: BrainAction, now: Date = new Date()): Item[] {
  if (action.query_kind === 'shopping') return shoppingItems(items, action.list_name);
  if (action.query_kind === 'overdue') return overdueItems(items, now);
  if (action.query_kind === 'briefing') return [...new Map([...todayItems(items, now), ...overdueItems(items, now)].map((item) => [item.id, item])).values()];
  if (isRangeQuery(action)) {
    const start = new Date(action.datetime as string);
    let end = action.end_datetime ? new Date(action.end_datetime) : start;
    // A midnight end (e.g. "พรุ่งนี้" → next-day 00:00) would spill into the
    // following day; pull it back a second so the range ends the night before.
    if (new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(end) === '00:00:00' && end > start) {
      end = new Date(end.getTime() - 1000);
    }
    return itemsInRange(items, start, end);
  }
  return todayItems(items, now);
}

/** Compose a spoken answer for a query action. */
export function answerQuery(items: Item[], action: BrainAction, now: Date = new Date(), language: 'th' | 'en' = 'en'): string {
  if (action.query_kind === 'shopping') {
    const shopping = shoppingItems(items, action.list_name);
    return shopping.length ? `Still to buy: ${shopping.map((item) => `${item.title}, ${item.details!.shopping!.quantity} ${item.details!.shopping!.unit}`).join('; ')}.` : 'There is nothing left on this shopping list.';
  }
  if (action.query_kind === 'overdue') {
    const overdue = overdueItems(items, now);
    return overdue.length ? `Overdue: ${overdue.map((item) => item.title).join(', ')}.` : 'There are no overdue tasks.';
  }
  if (action.query_kind === 'briefing') {
    return `${answerQuery(items, { ...action, query_kind: 'list_today' }, now, language)} ${answerQuery(items, { ...action, query_kind: 'overdue' }, now, language)}`;
  }
  const range = isRangeQuery(action);
  const all = queryItems(items, action, now);
  if (all.length === 0) {
    return range ? 'There are no items in that time range.' : 'You have no items scheduled for today.';
  }
  // Range spans days → show the date on each; today → time only.
  const lines = all
    .map((i) => `${i.title}${range ? dayTimeLabel(i.start_at, i.all_day, language) : timeLabel(i.start_at, i.all_day, language)}`)
    .join(', ');
  return `${range ? 'You have' : 'Today you have'} ${all.length} ${all.length === 1 ? 'item' : 'items'}: ${lines}`;
}
