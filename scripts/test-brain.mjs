// Quick CLI to exercise "the brain" (action planner) without opening the app.
//
//   node scripts/test-brain.mjs                 # runs the built-in samples
//   node scripts/test-brain.mjs "จ่ายค่าน้ำวันที่ 5"   # runs your own line
//
// Reads EXPO_PUBLIC_GROQ_API_KEY from .env. Mirrors src/brain/prompt.ts —
// keep the SYSTEM prompt in sync when you tune it.

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
หน้าที่: อ่านสิ่งที่ผู้ใช้พูด แล้วแปลงเป็น "แผนการกระทำ" (action plan) เป็น JSON ตัวเดียว ห้ามมีข้อความอื่นนอก JSON

สำคัญ: หนึ่งประโยคอาจมีได้หลายคำสั่ง ให้แตกเป็นหลาย action
timezone อ้างอิงคือ Asia/Bangkok เสมอ ทุก datetime ต้องเป็น ISO 8601 พร้อม offset +07:00
คำนวณเวลาสัมพัทธ์ ("พรุ่งนี้", "ก่อน 1 วัน") จาก "เวลาปัจจุบัน" ที่ให้มา

รูปแบบผลลัพธ์:
{
  "actions": [
    {
      "tool": "create_reminder" | "create_event" | "create_todo" | "create_note" | "record_expense" | "query",
      "title": string, "body": string|null,
      "datetime": string|null, "end_datetime": string|null, "all_day": boolean,
      "recurrence": null | { "freq":"daily"|"weekly"|"monthly"|"yearly", "byday": ["MO".."SU"]|null, "interval": number },
      "amount": number|null, "query_kind": "list_today"|"list_range"|"search"|null,
      "people": ["ชื่อ"]|null
    }
  ],
  "speak_back": string,
  "needs_clarification": boolean,
  "clarify_question": string|null
}
กติกา:
- create_todo = สิ่งที่ต้องทำแต่ไม่ระบุเวลาเตือน; ถ้ามีเวลาเตือนให้เพิ่ม create_reminder อีก action
- create_note = ไดอารี่/ความทรงจำ ใส่ people ถ้ามีคนเกี่ยวข้อง
- query_kind="search" = ค้นความทรงจำย้อนหลัง (เช่น "ลูกเริ่มพูดเมื่อไหร่") ใส่คำถามใน title
- query_kind="list_range" = ถามช่วง (เช่น "พรุ่งนี้มีอะไร") ต้องใส่ datetime=ต้นช่วง, end_datetime=ท้ายช่วง (ISO+07:00)
- "ทุกวันยกเว้นเสาร์อาทิตย์" => recurrence.freq="weekly", byday=["MO","TU","WE","TH","FR"]
- ถ้า create_reminder ไม่ระบุเวลาชัด (รวมแบบซ้ำ เช่น "ทุกวันที่ 1") ให้ตั้ง 09:00 อย่าใช้ 00:00
- ถ้า create_reminder บอกเวลาแบบกว้าง ("เช้า","เย็น","บ่าย") ไม่มีเวลาชัด ให้ needs_clarification=true, clarify_question="ประมาณกี่โมงครับ", actions=[]
- speak_back สั้นมาก เช่น "ได้ครับ"
- ตอบ JSON เท่านั้น`;

const SAMPLES = [
  'พรุ่งนี้อย่าลืมกินยาตอน 9 โมง',
  'ตั้งนาฬิกาปลุกให้หน่อยทุกวัน 8 โมง ยกเว้นวันเสาร์ อาทิตย์',
  'วันที่ 1 ถึง 2 กันยา พ่อแม่ไปขายของ เตือนผมก่อนหนึ่งวันด้วย', // multi-action
  'ต้องซื้ออาหารแมว',                                            // todo (no time)
  'เย็นนี้เตือนซื้อไข่ด้วย',                                       // todo + reminder
  'วันนี้เป็นวันแรกที่ลูกพูดได้',
  'วันนี้มีอะไรต้องทำบ้าง',
  'ลูกเริ่มพูดได้ตั้งแต่เมื่อไหร่นะ',   // memory recall → query_kind "search"
  'เตือนกินยาพรุ่งนี้เช้า',            // vague time → should ask "กี่โมง"
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
    const plan = await run(text);
    console.log(`🎙️  "${text}"`);
    for (const a of plan.actions ?? []) {
      const bits = [a.tool, a.title].filter(Boolean).join(' · ');
      console.log(`   → ${bits}`);
      if (a.datetime) console.log(`       ${a.datetime}${a.end_datetime ? ` → ${a.end_datetime}` : ''}`);
      if (a.recurrence) console.log(`       recurrence: ${JSON.stringify(a.recurrence)}`);
      if (a.amount != null) console.log(`       amount: ${a.amount}`);
      if (a.query_kind) console.log(`       query_kind: ${a.query_kind}`);
      if (a.people?.length) console.log(`       people: ${a.people.join(', ')}`);
    }
    if (plan.needs_clarification) console.log(`   ❓ ${plan.clarify_question}`);
    else console.log(`   🔊 ${plan.speak_back}`);
    console.log('');
  } catch (e) {
    console.error(`   ❌ ${e.message}\n`);
  }
}
