import type { CalendarSource, CalendarEvent } from './model';
export const appleAvailable = () => false;
export async function appleSources(_request = false): Promise<CalendarSource[]> { throw new Error('Apple Calendar is available in the iOS app.'); }
export async function appleEvents(_ids: string[], _start: string, _end: string): Promise<CalendarEvent[]> { throw new Error('Apple Calendar is available in the iOS app.'); }
