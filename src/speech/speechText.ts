// Convert compact display-oriented dates and times into text that OS voices
// pronounce naturally. Keep this separate from UI formatting: abbreviations
// are useful on screen but are unreliable input for text-to-speech engines.

const THAI_WEEKDAYS: Array<[string, string]> = [
  ['อา', 'วันอาทิตย์'],
  ['จ', 'วันจันทร์'],
  ['อ', 'วันอังคาร'],
  ['พ', 'วันพุธ'],
  ['พฤ', 'วันพฤหัสบดี'],
  ['ศ', 'วันศุกร์'],
  ['ส', 'วันเสาร์'],
];

const THAI_MONTHS: Array<[string, string]> = [
  ['ม.ค.', 'มกราคม'], ['ก.พ.', 'กุมภาพันธ์'], ['มี.ค.', 'มีนาคม'],
  ['เม.ย.', 'เมษายน'], ['พ.ค.', 'พฤษภาคม'], ['มิ.ย.', 'มิถุนายน'],
  ['ก.ค.', 'กรกฎาคม'], ['ส.ค.', 'สิงหาคม'], ['ก.ย.', 'กันยายน'],
  ['ต.ค.', 'ตุลาคม'], ['พ.ย.', 'พฤศจิกายน'], ['ธ.ค.', 'ธันวาคม'],
];

const ENGLISH_DATES: Array<[string, string]> = [
  ['Sun', 'Sunday'], ['Mon', 'Monday'], ['Tue', 'Tuesday'], ['Wed', 'Wednesday'],
  ['Thu', 'Thursday'], ['Fri', 'Friday'], ['Sat', 'Saturday'],
  ['Jan', 'January'], ['Feb', 'February'], ['Mar', 'March'], ['Apr', 'April'],
  ['Jun', 'June'], ['Jul', 'July'], ['Aug', 'August'], ['Sep', 'September'],
  ['Oct', 'October'], ['Nov', 'November'], ['Dec', 'December'],
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function englishClock(hour24: number, minute: number): string {
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour = hour24 % 12 || 12;
  return minute === 0 ? `${hour} ${period}` : `${hour} ${minute} ${period}`;
}

export function prepareTextForSpeech(input: string): string {
  const containsThai = /[ก-๙]/.test(input);
  let text = input;

  if (containsThai) {
    for (const [short, full] of THAI_WEEKDAYS) {
      // Expand weekday shorthand only when it precedes a numeric date.
      const pattern = new RegExp(
        `(^|[\\s(])${escapeRegExp(short)}\\.(?=\\s*\\d{1,2}(?:\\s|$))`,
        'g',
      );
      text = text.replace(pattern, `$1${full}`);
    }
    for (const [short, full] of THAI_MONTHS) {
      text = text.replace(new RegExp(escapeRegExp(short), 'g'), full);
    }
    text = text.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\s*น\./g, (_, hour, minute) => {
      const minuteNumber = Number(minute);
      return `เวลา ${Number(hour)} นาฬิกา${minuteNumber ? ` ${minuteNumber} นาที` : ''}`;
    });
  } else {
    for (const [short, full] of ENGLISH_DATES) {
      text = text.replace(new RegExp(`\\b${short}\\.?(?=[,\\s\\d])`, 'g'), full);
    }
    text = text.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (_, hour, minute) =>
      englishClock(Number(hour), Number(minute)),
    );
  }

  return text
    .replace(/\s*[·•]\s*/g, ', ')
    .replace(/\s+,/g, ',')
    .replace(/,{2,}/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function speechLanguageFor(text: string): 'th-TH' | 'en-US' {
  const thaiCharacters = text.match(/[ก-๙]/g)?.length ?? 0;
  const latinCharacters = text.match(/[A-Za-z]/g)?.length ?? 0;
  return thaiCharacters > latinCharacters ? 'th-TH' : 'en-US';
}
