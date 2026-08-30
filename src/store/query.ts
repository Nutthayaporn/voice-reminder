// Answers a `query` intent by reading the local store and composing a spoken
// Thai reply. Phase 2 handles the common cases (today / this week); richer
// natural-language search can grow here later.

import type { BrainResult } from '../brain/types';
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

/** Compose a spoken answer for a query intent. */
export function answerQuery(items: Item[], _brain: BrainResult, now: Date = new Date()): string {
  const todays = items
    .filter((i) => !i.done && occursOn(i, now))
    .sort((a, b) => (a.start_at ?? '').localeCompare(b.start_at ?? ''));

  if (todays.length === 0) {
    return 'วันนี้ยังไม่มีรายการที่ต้องทำครับ';
  }

  const lines = todays
    .map((i) => `${i.title}${timeLabel(i.start_at, i.all_day)}`)
    .join(', ');
  return `วันนี้มี ${todays.length} รายการครับ: ${lines}`;
}
