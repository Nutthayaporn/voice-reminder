import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import type { CalendarEvent, CalendarSource } from './model';
import { checked } from './model';
export const appleAvailable = () => Platform.OS === 'ios' && !!requireOptionalNativeModule('CalendarNext');
async function calendarModule(request = false) {
  if (!appleAvailable()) throw new Error('Apple Calendar needs an iOS development build with Calendar support.');
  const calendar = await import('expo-calendar');
  const permission = request ? await calendar.requestCalendarPermissions(false) : await calendar.getCalendarPermissions(false);
  if (!permission.granted) throw new Error('Allow calendar access in iPhone Settings to read your calendars.');
  return calendar;
}
export async function appleSources(request = false): Promise<CalendarSource[]> {
  const calendar = await calendarModule(request);
  const calendars = await calendar.getCalendars(calendar.EntityTypes.EVENT);
  return calendars.map(c => ({ id: c.id, provider: 'apple', name: c.title, color: c.color, account: c.source?.name }));
}
export async function appleEvents(ids: string[], start: string, end: string): Promise<CalendarEvent[]> {
  const calendar = await calendarModule();
  const available = await calendar.getCalendars(calendar.EntityTypes.EVENT);
  if (ids.some(id => !available.some(c => c.id === id))) throw new Error('An Apple calendar is no longer available. Choose calendars again.');
  if (!ids.length) return [];
  const rows = await calendar.listEvents(ids, new Date(start), new Date(end));
  // EventKit's external identifier is not exposed by this Expo API. Never guess
  // a cross-provider UID from the local event id or the title.
  return rows.filter(r => r.status !== 'canceled').map(r => {
    const localDay = (value: string | Date) => {
      const d = new Date(value);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T00:00:00+07:00`;
    };
    return checked({ id: r.id, calendarId: r.calendarId, provider: 'apple', title: r.title || 'Busy',
      start: r.allDay ? localDay(r.startDate) : new Date(r.startDate).toISOString(),
      end: r.allDay ? localDay(r.endDate) : new Date(r.endDate).toISOString(), allDay: r.allDay,
      busy: r.availability !== 'free' });
  });
}
