// Proves multi-turn reference resolution: given a list of "referable" items
// (what the app remembers from the previous turn), does the brain map
// "เลื่อนอันแรก…" / "ยกเลิกอันเมื่อกี้" / "จ่ายเน็ตแล้ว" to the right target_ref +
// tool? Mirrors src/brain/prompt.ts — keep the rules in sync.
//
//   node scripts/test-context.mjs
//   node scripts/test-context.mjs "ยกเลิกนัดหมอ"

import { readFileSync } from 'node:fs';
function loadEnv() {
  try {
    const txt = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {}
}
loadEnv();
const KEY = process.env.EXPO_PUBLIC_GROQ_API_KEY;
if (!KEY) { console.error('❌ ไม่พบ EXPO_PUBLIC_GROQ_API_KEY'); process.exit(1); }

const NOW = '2026-08-31T09:00:00+07:00 (วันจันทร์ที่ 31 สิงหาคม 2026)';

// What the previous turn left as "referable" (id + label incl. ISO).
const REFERENTS = [
  { ref: 'a1', label: 'ประชุมทีม — จ. 1 ก.ย. 10:00 น. {2026-09-01T10:00:00+07:00}' },
  { ref: 'b2', label: 'นัดหมอฟัน — จ. 1 ก.ย. 16:00 น. {2026-09-01T16:00:00+07:00}' },
  { ref: 'c3', label: 'จ่ายค่าเน็ต' },
];

const SYSTEM = `คุณคือ "สมอง" ของแอปผู้ช่วยเสียงภาษาไทย แปลงคำพูดเป็น action plan JSON ตัวเดียว ห้ามมีข้อความอื่น
timezone Asia/Bangkok, datetime เป็น ISO+07:00
tool: create_reminder|create_event|create_todo|create_note|record_expense|query|update_item|delete_item
ฟิลด์: tool,title,body,datetime,end_datetime,all_day,recurrence,alert_mode,remind_until_done,snooze_minutes,max_attempts,amount,query_kind,people,target_ref,done
- update_item = แก้/เลื่อน/ทำเสร็จ ของรายการเดิม; delete_item = ยกเลิก/ลบ — ต้องใส่ target_ref จาก "รายการอ้างอิง"
- ใส่เฉพาะฟิลด์ที่เปลี่ยน (เช่น datetime ใหม่ หรือ done=true)
- ถ้าผู้ใช้ขอเปลี่ยนเป็นนาฬิกาปลุกให้ alert_mode="alarm"; ถ้าเป็นแจ้งเตือนให้ "notification"
- ถ้าขอเตือนจนกว่าจะทำ ให้ alert_mode="alarm", remind_until_done=true; snooze_minutes รองรับ 5/10/30
- "เลื่อนปลุก/Snooze X นาที" เปลี่ยน snooze_minutes เท่านั้น ห้ามขยับ datetime; ขยับเวลาต่อเมื่อบอกเลื่อนรายการไปเวลาใหม่
- "อันแรก"=ลำดับ1, "อันเมื่อกี้/อันสุดท้าย"=ลำดับล่าสุด, หรือจับจากชื่อ ("จ่ายเน็ตแล้ว"=รายการเน็ต)
- ถ้ามี ISO ใน {..} ให้ยึดวันเดิมแล้วเปลี่ยนเฉพาะเวลา
- speak_back สั้น ๆ. ตอบ JSON: {"actions":[...],"speak_back":"..."}`;

function refBlock() {
  return REFERENTS.map((r, i) => `${i + 1}. [ref=${r.ref}] ${r.label}`).join('\n');
}

async function run(text) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai/gpt-oss-120b', temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `เวลาปัจจุบัน: ${NOW}\n\nรายการอ้างอิง:\n${refBlock()}\n\nผู้ใช้พูดว่า: "${text}"` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return JSON.parse((await res.json()).choices[0].message.content);
}

const inputs = process.argv.slice(2).length
  ? [process.argv.slice(2).join(' ')]
  : ['เลื่อนอันแรกไป 11 โมง', 'ยกเลิกนัดหมอ', 'จ่ายเน็ตแล้ว', 'อันเมื่อกี้เลื่อนไปบ่ายสาม'];

console.log('📌 รายการอ้างอิง:\n' + refBlock() + '\n');
for (const text of inputs) {
  try {
    const plan = await run(text);
    console.log(`🎙️  "${text}"`);
    for (const a of plan.actions ?? []) {
      const bits = [a.tool, a.target_ref ? `→${a.target_ref}` : '', a.title].filter(Boolean).join(' ');
      console.log(`   → ${bits}`);
      if (a.datetime) console.log(`       datetime: ${a.datetime}`);
      if (a.alert_mode) console.log(`       alert_mode: ${a.alert_mode}`);
      if (a.remind_until_done != null) console.log(`       remind_until_done: ${a.remind_until_done}`);
      if (a.snooze_minutes) console.log(`       snooze: ${a.snooze_minutes}m × ${a.max_attempts ?? 5}`);
      if (a.done != null) console.log(`       done: ${a.done}`);
    }
    console.log(`   🔊 ${plan.speak_back}\n`);
  } catch (e) {
    console.error(`   ❌ ${e.message}\n`);
  }
}
