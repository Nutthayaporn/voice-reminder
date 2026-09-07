export type Provider = 'google' | 'outlook' | 'apple';
export type CloudProvider = Exclude<Provider, 'apple'>;
export interface CalendarSource { id: string; name: string; provider: Provider; account?: string; color?: string }
export interface CalendarEvent {
  id: string; calendarId: string; provider: Provider; title: string;
  start: string; end: string; allDay: boolean; uid?: string; busy: boolean;
}
export interface Connection { provider: CloudProvider; connected: boolean; ready: boolean }
export const providerNames: Record<Provider, string> = { google: 'Google Calendar', outlook: 'Outlook', apple: 'Apple Calendar' };
export const sourceKey = (source: Pick<CalendarSource, 'provider' | 'id'>) => `${source.provider}:${source.id}`;
export function validRange(start: string, end: string) {
  const a = Date.parse(start), b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a || b - a > 366 * 86400000) throw new Error('Choose a calendar range of up to 366 days.');
}
export function defaultRange(now = new Date()) {
  return { start: new Date(now.getTime() - 30 * 86400000).toISOString(), end: new Date(now.getTime() + 180 * 86400000).toISOString() };
}
const day = (value: string) => `${value.slice(0, 10)}T00:00:00+07:00`;
const utc = (value: string) => /(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? value : `${value}Z`;
export function googleEvent(raw: any, calendarId: string): CalendarEvent | null {
  if (raw.status === 'cancelled' || raw.attendees?.some((a: any) => a.self && a.responseStatus === 'declined')) return null;
  const allDay = !!raw.start?.date;
  return checked({ id: raw.id, calendarId, provider: 'google', title: raw.summary || 'Busy',
    start: allDay ? day(raw.start.date) : raw.start?.dateTime,
    end: allDay ? day(raw.end?.date ?? '') : raw.end?.dateTime,
    allDay, uid: raw.iCalUID, busy: raw.transparency !== 'transparent' });
}
export function outlookEvent(raw: any, calendarId: string): CalendarEvent | null {
  if (raw.isCancelled || raw.responseStatus?.response === 'declined') return null;
  // Graph requests explicitly use Prefer: outlook.timezone="UTC".
  return checked({ id: raw.id, calendarId, provider: 'outlook', title: raw.subject || 'Busy',
    start: raw.isAllDay ? day(raw.start?.dateTime ?? '') : utc(raw.start?.dateTime ?? ''),
    end: raw.isAllDay ? day(raw.end?.dateTime ?? '') : utc(raw.end?.dateTime ?? ''),
    allDay: !!raw.isAllDay, uid: raw.iCalUId, busy: raw.showAs !== 'free' && raw.showAs !== 'workingElsewhere' });
}
export function checked(event: CalendarEvent): CalendarEvent {
  if (!event.id || !Number.isFinite(Date.parse(event.start)) || !Number.isFinite(Date.parse(event.end)) || Date.parse(event.end) < Date.parse(event.start)) throw new Error('A calendar returned an invalid event. Please retry.');
  return event;
}
/** Only verified UID + occurrence time dedupes across sources; matching titles alone never do. */
export function dedupeEvents(events: CalendarEvent[]): CalendarEvent[] {
  const result = new Map<string, CalendarEvent>();
  for (const event of [...events].sort((a,b) => Number(a.provider === 'apple') - Number(b.provider === 'apple'))) {
    const occurrence = `${Date.parse(event.start)}:${Date.parse(event.end)}`;
    const key = event.uid ? `uid:${event.uid}:${occurrence}` : `${event.provider}:${event.calendarId}:${event.id}:${occurrence}`;
    const previous = result.get(key);
    result.set(key, previous ? { ...previous, busy: previous.busy || event.busy } : event);
  }
  return [...result.values()].sort((a,b) => Date.parse(a.start) - Date.parse(b.start));
}
