// Quick CLI to exercise "the brain" without opening the app.
//
//   node scripts/test-brain.mjs                 # runs the built-in samples
//   node scripts/test-brain.mjs "จ่ายค่าน้ำวันที่ 5"   # runs your own line
//
// Reads EXPO_PUBLIC_GROQ_API_KEY from .env. This mirrors the prompt in
// src/brain/prompt.ts — keep them in sync when you tune the system prompt.

import { readFileSync } from 'node:fs';

function loadEnv() {
  try {
    const txt = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    /* no .env — rely on real env */
  }
}
loadEnv();

const KEY = process.env.EXPO_PUBLIC_GROQ_API_KEY;
if (!KEY) {
  console.error('❌ ไม่พบ EXPO_PUBLIC_GROQ_API_KEY ใน .env');
  process.exit(1);
}

const TZ = 'Asia/Bangkok';
function nowContext(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now);
  const p = (t) => parts.find((x) => x.type === t)?.value ?? '';
  const iso = `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}:${p('second')}+07:00`;
  const thai = new Intl.DateTimeFormat('th-TH', {
    timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(now);
  return `${iso} (${thai})`;
}

// Kept in sync with src/brain/prompt.ts (SYSTEM). Update both together.
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

const SAMPLES = [
  'พรุ่งนี้อย่าลืมกินยาตอน 9 โมง',
  'ตั้งนาฬิกาปลุกให้หน่อยทุกวัน 8 โมง ยกเว้นวันเสาร์ อาทิตย์',
  'วันที่ 1 ถึง 2 กันยา พ่อแม่ไปขายของ',
  'วันนี้เป็นวันแรกที่ลูกพูดได้',
  'วันนี้มีอะไรต้องทำบ้าง',
  'ซื้อโจ๊กไป 60 บาท',
];

async function run(text) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai/gpt-oss-120b',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `เวลาปัจจุบัน: ${nowContext()}\n\nผู้ใช้พูดว่า: "${text}"` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

const inputs = process.argv.slice(2).length ? [process.argv.slice(2).join(' ')] : SAMPLES;
console.log(`🕐 ${nowContext()}\n`);
for (const text of inputs) {
  try {
    const r = await run(text);
    console.log(`🎙️  "${text}"`);
    console.log(`   → ${r.intent} · ${r.title}`);
    if (r.datetime) console.log(`     datetime: ${r.datetime}${r.end_datetime ? ` → ${r.end_datetime}` : ''}`);
    if (r.recurrence) console.log(`     recurrence: ${JSON.stringify(r.recurrence)}`);
    if (r.amount != null) console.log(`     amount: ${r.amount}`);
    console.log(`     🔊 ${r.speak_back}\n`);
  } catch (e) {
    console.error(`   ❌ ${e.message}\n`);
  }
}
