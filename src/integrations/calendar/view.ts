import type { Item } from '../../store/types';
import type { CalendarEvent } from './model';
export function eventItem(event: CalendarEvent): Item {
  return { id: `external:${event.provider}:${event.calendarId}:${event.id}:${event.start}`,
    type: 'event', title: event.title, body: null, household_id: null, start_at: event.start,
    end_at: event.end, all_day: event.allDay, recurrence: null, done: false,
    created_at: event.start, updated_at: event.start, notificationIds: [],
    alert_mode: 'notification', remind_until_done: false, snooze_minutes: 10, max_attempts: 1,
    externalCalendar: { provider: event.provider, calendarId: event.calendarId, busy: event.busy } };
}
