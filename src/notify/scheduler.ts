// Turns an Item's time + recurrence into scheduled local notifications.
//
// Returns the scheduled notification ids so the store can cancel them if the
// item is deleted. All guarded: in Expo Go (no native module) this no-ops and
// returns [] — the item still saves, it just won't alarm until a dev build.

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { SchedulableTriggerInputTypes } from 'expo-notifications';

import type { Item } from '../store/types';
import { cancelNativeAlarm, scheduleNativeAlarm } from './nativeAlarm';

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
  if (Platform.OS === 'web') return [];
  // Notes never alarm; anything without a time can't be scheduled.
  if (item.done || item.type === 'note' || !item.start_at) return [];

  if (item.type === 'reminder' && item.alert_mode === 'alarm') {
    const nativeId = await scheduleNativeAlarm(item);
    if (nativeId) return [`alarm:${nativeId}`];
  }

  const p = bkkParts(item.start_at);
  // For an all-day item with no explicit time, nudge at 08:00.
  const hour = item.all_day ? 8 : p.hour;
  const minute = item.all_day ? 0 : p.minute;

  const bodyByType: Record<string, string> = {
    reminder: 'It is time ⏰',
    todo: 'Do not forget ☑️',
    event: 'Scheduled for today 📅',
  };
  const content: Notifications.NotificationContentInput = {
    title: item.title,
    body:
      item.alert_mode === 'alarm'
        ? 'Alarm mode · Tap to open VORA'
        : (bodyByType[item.type] ?? 'Reminder'),
    sound: item.alert_mode === 'alarm' && Platform.OS === 'ios' ? 'defaultRingtone' : 'default',
    interruptionLevel: item.alert_mode === 'alarm' ? 'timeSensitive' : 'active',
    priority:
      item.alert_mode === 'alarm'
        ? Notifications.AndroidNotificationPriority.MAX
        : Notifications.AndroidNotificationPriority.HIGH,
    data: {
      itemId: item.id,
      alertMode: item.alert_mode,
      remindUntilDone: item.remind_until_done,
    },
  };

  const channelId = item.alert_mode === 'alarm' ? 'alarm-fallback' : 'default';
  const triggers = buildTriggers(item, { ...p, hour, minute }, channelId);
  const ids: string[] = [];
  for (const trigger of triggers) {
    try {
      const id = await Notifications.scheduleNotificationAsync({ content, trigger });
      ids.push(`notification:${id}`);
    } catch {
      /* native module missing / past date — skip this trigger */
    }
  }


  // When native alarm APIs are unavailable, a one-shot "until done" reminder
  // still repeats as prominent notifications. Every pending attempt is kept in
  // notificationIds, so tapping Done in the app can cancel the rest.
  if (item.remind_until_done && !item.recurrence) {
    const first = new Date(item.start_at).getTime();
    for (let attempt = 2; attempt <= item.max_attempts; attempt += 1) {
      const date = new Date(first + (attempt - 1) * item.snooze_minutes * 60_000);
      if (date.getTime() <= Date.now()) continue;
      try {
        const id = await Notifications.scheduleNotificationAsync({
          content: {
            ...content,
            body: `Not marked as done · Attempt ${attempt}/${item.max_attempts}`,
          },
          trigger: { type: SchedulableTriggerInputTypes.DATE, date, channelId },
        });
        ids.push(`notification:${id}`);
      } catch {
        /* keep the base notification even if one repeat could not be scheduled */
      }
    }
  }
  return ids;
}

function buildTriggers(
  item: Item,
  p: Parts,
  channelId: string,
): Notifications.NotificationTriggerInput[] {
  const r = item.recurrence;

  if (!r) {
    // one-shot — skip if already in the past
    const when = new Date(item.start_at as string);
    if (when.getTime() <= Date.now()) return [];
    return [{ type: SchedulableTriggerInputTypes.DATE, date: when, channelId }];
  }

  switch (r.freq) {
    case 'daily':
      return [{ type: SchedulableTriggerInputTypes.DAILY, hour: p.hour, minute: p.minute, channelId }];
    case 'weekly': {
      // one weekly trigger per selected day; fall back to the start day
      const days = r.byday?.length ? r.byday : weekdayCode(p.weekday);
      return days.map((code) => ({
        type: SchedulableTriggerInputTypes.WEEKLY,
        weekday: DAY_TO_WEEKDAY[code] ?? p.weekday,
        hour: p.hour,
        minute: p.minute,
        channelId,
      }));
    }
    case 'monthly':
      return [
        { type: SchedulableTriggerInputTypes.MONTHLY, day: p.day, hour: p.hour, minute: p.minute, channelId },
      ];
    case 'yearly':
      return [
        {
          type: SchedulableTriggerInputTypes.YEARLY,
          day: p.day,
          month: p.month - 1, // expo YEARLY month is 0-indexed
          hour: p.hour,
          minute: p.minute,
          channelId,
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
  if (Platform.OS === 'web') return;
  for (const id of ids) {
    if (id.startsWith('alarm:')) {
      await cancelNativeAlarm(id.slice('alarm:'.length));
      continue;
    }
    try {
      const notificationId = id.startsWith('notification:')
        ? id.slice('notification:'.length)
        : id;
      await Notifications.cancelScheduledNotificationAsync(notificationId);
    } catch {
      /* already gone */
    }
  }
}
