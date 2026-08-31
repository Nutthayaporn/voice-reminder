// Answers a `query` intent by reading the local store and composing a spoken
// Thai reply. Phase 2 handles the common cases (today / this week); richer
// natural-language search can grow here later.

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

function timeLabel(iso: string | null, allDay: boolean): string {
  if (!iso || allDay) return '';
  const t = new Intl.DateTimeFormat('th-TH', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
  return ` เวลา ${t} น.`;
}

/** Does this item occur on `day` (a Bangkok calendar date)? */
function occursOn(item: Item, day: Date): boolean {
  const dayStr = bkkDateStr(day);

  // Range events: start..end covers the day.
  if (item.start_at && item.end_at) {
    return bkkDateStr(item.start_at) <= dayStr && dayStr <= bkkDateStr(item.end_at);
  }
  if (!item.start_at) return false;

  const startStr = bkkDateStr(item.start_at);
  if (!item.recurrence) return startStr === dayStr;

  // Recurring: only counts once it has started.
  if (startStr > dayStr) return false;
  const r = item.recurrence;
  switch (r.freq) {
    case 'daily':
      return true;
    case 'weekly': {
      const code = bkkWeekdayCode(day);
      return r.byday?.length
        ? (r.byday as string[]).includes(code)
        : bkkWeekdayCode(new Date(item.start_at)) === code;
    }
    case 'monthly':
      // same day-of-month
      return startStr.slice(8, 10) === dayStr.slice(8, 10);
    case 'yearly':
      // same month-day (MM-DD)
      return startStr.slice(5) === dayStr.slice(5);
    default:
      return false;
  }
}

/** Short Thai date+time label, e.g. " · 1 ก.ย. เวลา 10:00 น." (for range lists). */
function dayTimeLabel(iso: string | null, allDay: boolean): string {
  if (!iso) return '';
  const date = new Intl.DateTimeFormat('th-TH', {
    timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short',
  }).format(new Date(iso));
  return allDay ? ` · ${date}` : ` · ${date}${timeLabel(iso, false)}`;
}

/** The ordered set of items relevant "today" — dated occurrences + standing
 *  todos. Shared by the spoken answer and the multi-turn referent list so
 *  "อันแรก" points at exactly what was read out. */
export function todayItems(items: Item[], now: Date = new Date()): Item[] {
  const dated = items.filter((i) => !i.done && occursOn(i, now));
  const undatedTodos = items.filter((i) => !i.done && i.type === 'todo' && !i.start_at);
  return [...dated, ...undatedTodos].sort((a, b) =>
    (a.start_at ?? '9999').localeCompare(b.start_at ?? '9999'),
  );
}

/** Items occurring on any day within [start, end] (inclusive). Iterates day by
 *  day so recurring rules are honoured; deduped by id. */
export function itemsInRange(items: Item[], start: Date, end: Date): Item[] {
  const out = new Map<string, Item>();
  const day = new Date(start);
  day.setHours(0, 0, 0, 0);
  let guard = 0;
  while (day.getTime() <= end.getTime() && guard++ < 90) {
    for (const i of items) {
      if (!i.done && occursOn(i, day)) out.set(i.id, i);
    }
    day.setDate(day.getDate() + 1);
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
  if (isRangeQuery(action)) {
    const start = new Date(action.datetime as string);
    let end = action.end_datetime ? new Date(action.end_datetime) : start;
    // A midnight end (e.g. "พรุ่งนี้" → next-day 00:00) would spill into the
    // following day; pull it back a second so the range ends the night before.
    if (end.getSeconds() === 0 && end.getMinutes() === 0 && end.getHours() === 0 && end > start) {
      end = new Date(end.getTime() - 1000);
    }
    return itemsInRange(items, start, end);
  }
  return todayItems(items, now);
}

/** Compose a spoken answer for a query action. */
export function answerQuery(items: Item[], action: BrainAction, now: Date = new Date()): string {
  const range = isRangeQuery(action);
  const all = queryItems(items, action, now);
  if (all.length === 0) {
    return range ? 'ช่วงที่ถามยังไม่มีรายการครับ' : 'วันนี้ยังไม่มีรายการที่ต้องทำครับ';
  }
  // Range spans days → show the date on each; today → time only.
  const lines = all
    .map((i) => `${i.title}${range ? dayTimeLabel(i.start_at, i.all_day) : timeLabel(i.start_at, i.all_day)}`)
    .join(', ');
  return `${range ? 'มี' : 'วันนี้มี'} ${all.length} รายการครับ: ${lines}`;
}
