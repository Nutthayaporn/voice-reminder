// Proves the semantic memory retriever (src/brain/searchMemory.ts) end-to-end
// with a small fake diary. Groq has no embeddings, so we use the LLM as the
// retriever. Mirrors the SYSTEM prompt in searchMemory.ts — keep in sync.
//
//   node scripts/test-memory.mjs                       # runs built-in questions
//   node scripts/test-memory.mjs "ไปทะเลครั้งล่าสุดเมื่อไหร่"

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

// Fake diary (what the store would hold after a few voice notes).
const MEMORIES = [
  { date: '15 มีนาคม 2026', people: 'ลูก', text: 'วันนี้เป็นวันแรกที่ลูกพูดคำว่าพ่อได้' },
  { date: '2 เมษายน 2026', people: 'ลูก', text: 'ลูกเดินได้เองเป็นครั้งแรก 3 ก้าว' },
  { date: '10 กรกฎาคม 2026', people: 'ครอบครัว', text: 'ไปเที่ยวทะเลหัวหินกันทั้งครอบครัว' },
  { date: '20 สิงหาคม 2026', people: 'แม่', text: 'แม่เริ่มออกกำลังกายตอนเช้าทุกวัน' },
];

const SYSTEM = `คุณคือผู้ช่วยความทรงจำส่วนตัว ตอบคำถามของผู้ใช้จาก "บันทึก" ที่ให้มาเท่านั้น
- ตอบเป็นภาษาไทย สั้น เป็นประโยคพูด
- ถ้าบันทึกมีวันที่ ให้บอกวันที่ด้วย
- ถ้าไม่พบข้อมูลที่เกี่ยวข้อง ตอบว่า "ผมไม่พบบันทึกเรื่องนี้ครับ"
- อย่าเดา อย่าแต่งข้อมูลที่ไม่มีในบันทึก`;

const context = MEMORIES.map((m) => `- (${m.date}) [${m.people}] ${m.text}`).join('\n');

async function ask(question) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai/gpt-oss-120b',
      temperature: 0.1,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `บันทึกทั้งหมด:\n${context}\n\nคำถาม: ${question}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()).choices[0].message.content.trim();
}

const questions = process.argv.slice(2).length
  ? [process.argv.slice(2).join(' ')]
  : [
      'ลูกเริ่มพูดได้เมื่อไหร่',
      'ลูกเดินได้ตอนไหน',
      'ไปเที่ยวทะเลครั้งล่าสุดที่ไหน เมื่อไหร่',
      'ปีที่แล้วไปญี่ปุ่นเมื่อไหร่', // not in the diary → should say not found
    ];

console.log('📔 บันทึกตัวอย่าง:\n' + context + '\n');
for (const q of questions) {
  try {
    console.log(`❓ ${q}`);
    console.log(`   🔊 ${await ask(q)}\n`);
  } catch (e) {
    console.error(`   ❌ ${e.message}\n`);
  }
}
