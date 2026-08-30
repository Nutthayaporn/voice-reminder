// Small date helpers, all anchored to Asia/Bangkok so behaviour doesn't depend
// on the device's own timezone.

const TZ = 'Asia/Bangkok';

/** 'YYYY-MM-DD' for the given instant (or now) in Bangkok. */
export function bkkDateStr(input: string | Date = new Date()): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
