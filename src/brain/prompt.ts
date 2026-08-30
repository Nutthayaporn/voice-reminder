// Builds the chat messages for the intent LLM.
//
// The single most important thing here: give the model the CURRENT date/time in
// Asia/Bangkok on every call, so it can resolve "พรุ่งนี้ / เดือนนี้ / 1–2 Sep /
// ทุกวันยกเว้นเสาร์อาทิตย์" into concrete ISO datetimes. Everything else is a
// schema description plus a few worked examples in the user's own phrasing.

const TZ = 'Asia/Bangkok';

/** e.g. "2026-08-31T00:34:00+07:00 (วันอาทิตย์ 31 สิงหาคม 2026)" */
export function nowContext(now: Date = new Date()): string {
  // Wall-clock parts in Bangkok regardless of the device's own timezone.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  const iso = `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}:${p('second')}+07:00`;

  const thai = new Intl.DateTimeFormat('th-TH', {
    timeZone: TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);

  return `${iso} (${thai})`;
}

const SYSTEM = `คุณคือ "สมอง" ของแอปผู้ช่วยส่วนตัวสั่งงานด้วยเสียงภาษาไทย
หน้าที่: อ่านสิ่งที่ผู้ใช้พูด แล้วแปลงเป็น JSON ตาม schema เป๊ะ ๆ ตัวเดียว ห้ามมีข้อความอื่นนอก JSON

timezone อ้างอิงคือ Asia/Bangkok เสมอ ทุก datetime ต้องเป็น ISO 8601 พร้อม offset +07:00
ให้คำนวณคำบอกเวลาสัมพัทธ์ ("พรุ่งนี้", "มะรืน", "เดือนนี้", "อาทิตย์หน้า") จาก "เวลาปัจจุบัน" ที่ให้มา

schema (ใส่ค่าที่เกี่ยวข้อง ที่เหลือใส่ null):
{
  "intent": "create_reminder" | "create_event" | "create_note" | "query" | "add_expense" | "unknown",
  "title": string,               // ป้ายสั้น เช่น "กินยา", "ตั้งปลุก"
  "body": string | null,         // รายละเอียด/เนื้อโน้ต
  "datetime": string | null,     // ISO+07:00 จุดเวลา/เวลาเริ่ม
  "end_datetime": string | null, // ISO+07:00 เวลาสิ้นสุด (ช่วงวัน)
  "all_day": boolean,            // true ถ้าไม่เจาะเวลา
  "recurrence": null | { "freq":"daily"|"weekly"|"monthly"|"yearly", "byday": ["MO".."SU"] | null, "interval": number },
  "amount": number | null,       // เฉพาะ add_expense (บาท)
  "query_kind": "list_today" | "list_range" | "search" | null,
  "speak_back": string           // ประโยคภาษาไทยสั้น กระชับ สุภาพ ยืนยันสิ่งที่บันทึก/ตอบคำถาม
}

กติกา:
- reminder = มีเวลาชัดและอยากถูกเตือน; event = เหตุการณ์/ช่วงวัน; note = บันทึกความทรงจำ/ไดอารี่
- "ทุกวันยกเว้นเสาร์อาทิตย์" => recurrence.freq="weekly", byday=["MO","TU","WE","TH","FR"]
- ถ้าไม่ระบุปี ใช้ปีปัจจุบัน; ถ้าเวลาที่พูดผ่านไปแล้ววันนี้และเป็น reminder ครั้งเดียว ให้ตีความเป็นวันถัดไปที่สมเหตุผล
- speak_back พูดกับผู้ใช้ตรง ๆ เช่น "ตั้งเตือนกินยาพรุ่งนี้ 9 โมงเช้าให้แล้วนะครับ"
- ตอบ JSON เท่านั้น`;

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export function buildMessages(text: string, now: Date = new Date()): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `เวลาปัจจุบัน: ${nowContext(now)}\n\nผู้ใช้พูดว่า: "${text}"` },
  ];
}
