// Turns an Item's time + recurrence into scheduled local notifications.
//
// Returns the scheduled notification ids so the store can cancel them if the
// item is deleted. All guarded: in Expo Go (no native module) this no-ops and
// returns [] — the item still saves, it just won't alarm until a dev build.

import * as Notifications from 'expo-notifications';
import { SchedulableTriggerInputTypes } from 'expo-notifications';

import type { Item } from '../store/types';

const TZ = 'Asia/Bangkok';
// byday code → weekday number (expo WEEKLY: 1=Sunday … 7=Saturday)
const DAY_TO_WEEKDAY: Record<string, number> = {
  SU: 1, MO: 2, TU: 3, WE: 4, TH: 5, FR: 6, SA: 7,
};

interface Parts {
  year: number; month: number; day: number; hour: number; minute: number; weekday: number;
}

/** Break an ISO instant into Bangkok wall-clock parts. */
function bkkParts(iso: string): Parts {
  const d = new Date(iso);
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(d);
  const get = (t: string) => f.find((x) => x.type === t)?.value ?? '';
  const wdMap: Record<string, number> = { Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6, Sat: 7 };
  return {
    year: +get('year'),
    month: +get('month'),
    day: +get('day'),
    hour: +get('hour') % 24, // '24' → 0 at midnight in some locales
    minute: +get('minute'),
    weekday: wdMap[get('weekday')] ?? 1,
  };
}

/** Schedule notifications for an item; returns the scheduled ids (may be []). */
export async function scheduleForItem(item: Item): Promise<string[]> {
  // Notes never alarm; anything without a time can't be scheduled.
  if (item.type === 'note' || !item.start_at) return [];

  const p = bkkParts(item.start_at);
  // For an all-day item with no explicit time, nudge at 08:00.
  const hour = item.all_day ? 8 : p.hour;
  const minute = item.all_day ? 0 : p.minute;

  const bodyByType: Record<string, string> = {
    reminder: 'ถึงเวลาแล้ว ⏰',
    todo: 'อย่าลืมทำ ☑️',
    event: 'มีรายการวันนี้ 📅',
  };
  const content: Notifications.NotificationContentInput = {
    title: item.title,
    body: bodyByType[item.type] ?? 'แจ้งเตือน',
    sound: 'default',
  };

  const triggers = buildTriggers(item, { ...p, hour, minute });
  const ids: string[] = [];
  for (const trigger of triggers) {
    try {
      ids.push(await Notifications.scheduleNotificationAsync({ content, trigger }));
    } catch {
      /* native module missing / past date — skip this trigger */
    }
  }
  return ids;
}

function buildTriggers(
  item: Item,
  p: Parts,
): Notifications.NotificationTriggerInput[] {
  const r = item.recurrence;

  if (!r) {
    // one-shot — skip if already in the past
    const when = new Date(item.start_at as string);
    if (when.getTime() <= Date.now()) return [];
    return [{ type: SchedulableTriggerInputTypes.DATE, date: when }];
  }

  switch (r.freq) {
    case 'daily':
      return [{ type: SchedulableTriggerInputTypes.DAILY, hour: p.hour, minute: p.minute }];
    case 'weekly': {
      // one weekly trigger per selected day; fall back to the start day
      const days = r.byday?.length ? r.byday : weekdayCode(p.weekday);
      return days.map((code) => ({
        type: SchedulableTriggerInputTypes.WEEKLY,
        weekday: DAY_TO_WEEKDAY[code] ?? p.weekday,
        hour: p.hour,
        minute: p.minute,
      }));
    }
    case 'monthly':
      return [
        { type: SchedulableTriggerInputTypes.MONTHLY, day: p.day, hour: p.hour, minute: p.minute },
      ];
    case 'yearly':
      return [
        {
          type: SchedulableTriggerInputTypes.YEARLY,
          day: p.day,
          month: p.month - 1, // expo YEARLY month is 0-indexed
          hour: p.hour,
          minute: p.minute,
        },
      ];
    default:
      return [];
  }
}

function weekdayCode(weekday: number): string[] {
  const inv: Record<number, string> = { 1: 'SU', 2: 'MO', 3: 'TU', 4: 'WE', 5: 'TH', 6: 'FR', 7: 'SA' };
  return [inv[weekday] ?? 'MO'];
}

/** Cancel previously scheduled notifications for an item. */
export async function cancelNotifications(ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {
      /* already gone */
    }
  }
}
