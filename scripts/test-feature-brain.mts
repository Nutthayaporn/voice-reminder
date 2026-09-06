// Optional live integration test using only synthetic data and the actual app prompt.
import assert from 'node:assert/strict';
import { buildMessages } from '../src/brain/prompt.ts';
process.loadEnvFile('.env');
const key = process.env.EXPO_PUBLIC_GROQ_API_KEY;
if (!key) throw new Error('Groq key is required for this optional live test.');
const spaces = [{ id: 'fixture-a', name: 'สวนมะนาว', aliases: ['สวนเรา'] }, { id: 'fixture-b', name: 'ทีมดาวเหนือ' }];
const cases = [
  { text: 'จำไว้ว่าตอนเช้าของผมคือเจ็ดโมงครึ่ง', check: (p: any) => { const a = p.actions.find((a: any) => a.tool === 'set_preference'); assert.equal(a?.preference_value, '07:30'); } },
  { text: 'ช่วยหาช่วงว่างหนึ่งชั่วโมงพรุ่งนี้ตั้งแต่เก้าโมงถึงห้าโมงเย็น', check: (p: any) => { assert.equal(p.actions[0]?.tool, 'find_free_time'); assert.equal(p.actions[0]?.duration_minutes, 60); assert.ok(p.actions[0]?.end_datetime); } },
  { text: 'จากนี้ตอบภาษาไทยนะ', check: (p: any) => { assert.equal(p.actions[0]?.tool, 'set_preference'); assert.equal(p.actions[0]?.preference_value, 'th'); } },
  { text: 'เพิ่มไข่สองแผงในลิสต์ซื้อของ ใน space สวนมะนาว', check: (p: any) => { const a = p.actions.find((a: any) => a.tool === 'add_shopping'); assert.equal(a?.space_ref, 'fixture-a'); assert.equal(a.quantity, 2); } },
  { text: 'จดส่วนตัวว่าต้องซื้อของขวัญ', check: (p: any) => assert.equal(p.actions[0]?.space_ref, 'personal') },
  { text: 'โมจิคือแมวของเรา จดส่วนตัว', check: (p: any) => { assert.equal(p.actions[0]?.tool, 'remember_entity'); assert.equal(p.actions[0]?.entity_kind, 'pet'); } },
  { text: 'พรุ่งนี้สิบโมงมีนัดหมอ เตือนก่อนหนึ่งชั่วโมง', check: (p: any) => { assert.ok(p.actions.some((a: any) => a.tool === 'create_event')); assert.equal(p.actions.find((a: any) => a.tool === 'create_reminder')?.parent_ref, 'action:1'); } },
  { text: 'สรุปวันนี้ให้หน่อย', check: (p: any) => assert.ok(p.actions.some((a: any) => a.query_kind === 'briefing')) },
  { text: 'แอปนี้ช่วยอะไรได้บ้าง', check: (p: any) => assert.ok(p.actions.some((a: any) => a.tool === 'help')) },
];
let failed = 0;
for (const test of cases) {
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.EXPO_PUBLIC_GROQ_LLM_MODEL || 'openai/gpt-oss-120b', temperature: 0,
        response_format: { type: 'json_object' }, messages: buildMessages(test.text, new Date('2026-09-07T09:00:00+07:00'), { referents: [], spaces, selectedSpaceId: 'fixture-b', capabilities: 'Notes, reminders, entities, shopping, briefing and help.' }) }),
    });
    if (response.status === 429) { console.error('Live verification paused: Groq rate limit (429).'); failed++; break; }
    if (!response.ok) throw new Error(`Groq status ${response.status}`);
    const result = await response.json() as any;
    const plan = JSON.parse(result.choices[0].message.content);
    test.check(plan);
    console.log(`✓ ${test.text}`);
  } catch (error) { failed++; console.error(`FAIL ${test.text}: ${error instanceof Error ? error.message : String(error)}`); }
}
if (failed) process.exitCode = 1;
