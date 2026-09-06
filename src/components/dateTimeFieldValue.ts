const TIME_ZONE = 'Asia/Bangkok';

export type DateTimePart = 'date' | 'time';

interface BangkokParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
}

function bangkokParts(value: Date): BangkokParts {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  };
}

function toIso(parts: BangkokParts, allDay: boolean): string {
  const hour = allDay ? '00' : parts.hour;
  const minute = allDay ? '00' : parts.minute;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${minute}:00+07:00`;
}

export function pickerDate(value: string | null): Date {
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

export function initialBangkokValue(allDay: boolean): string {
  return toIso(bangkokParts(new Date()), allDay);
}

export function updateBangkokPart(
  currentValue: string | null,
  selectedValue: Date,
  part: DateTimePart,
  allDay: boolean,
): string {
  const current = bangkokParts(pickerDate(currentValue));
  const selected = bangkokParts(selectedValue);
  const next = part === 'date'
    ? { ...current, year: selected.year, month: selected.month, day: selected.day }
    : { ...current, hour: selected.hour, minute: selected.minute };
  return toIso(next, allDay);
}

export function dateInputValue(value: string | null): string {
  return value?.slice(0, 10) ?? '';
}

export function timeInputValue(value: string | null): string {
  return value?.slice(11, 16) ?? '';
}

export function updateWebDate(
  currentValue: string | null,
  date: string,
  allDay: boolean,
): string | null {
  if (!date) return null;
  const time = allDay ? '00:00' : timeInputValue(currentValue) || timeInputValue(initialBangkokValue(false));
  return `${date}T${time}:00+07:00`;
}

export function updateWebTime(currentValue: string | null, time: string): string {
  const date = dateInputValue(currentValue) || dateInputValue(initialBangkokValue(false));
  return `${date}T${time || '00:00'}:00+07:00`;
}
