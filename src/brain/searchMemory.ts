// Semantic memory recall — answers "ลูกเริ่มพูดได้เมื่อไหร่" from past notes.
//
// Groq has no embeddings model and a personal diary is small (tens–hundreds of
// entries), so we use the LLM itself as the retriever: send the question plus a
// compact list of memories and let it find + phrase the answer. This keeps the
// free Groq stack and needs no vector store. If the corpus ever gets large,
// swap this for an embeddings index behind the same function signature.

import { config } from '../config';
import type { Item } from '../store/types';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const TZ = 'Asia/Bangkok';

const SYSTEM = `คุณคือผู้ช่วยความทรงจำส่วนตัว ตอบคำถามของผู้ใช้จาก "บันทึก" ที่ให้มาเท่านั้น
- ตอบเป็นภาษาไทย สั้น เป็นประโยคพูด (จะถูกอ่านออกเสียง)
- ถ้าบันทึกมีวันที่ ให้บอกวันที่ด้วย เช่น "เมื่อ 31 สิงหาคม 2026"
- ถ้าไม่พบข้อมูลที่เกี่ยวข้อง ตอบว่า "ผมไม่พบบันทึกเรื่องนี้ครับ"
- อย่าเดา อย่าแต่งข้อมูลที่ไม่มีในบันทึก`;

/** Turn one item into a compact line for the retrieval context. */
function line(i: Item): string {
  const date = i.start_at
    ? new Intl.DateTimeFormat('th-TH', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(i.start_at))
    : new Intl.DateTimeFormat('th-TH', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(i.created_at));
  const who = i.people?.length ? ` [${i.people.join(', ')}]` : '';
  const text = i.raw_text || i.title;
  return `- (${date})${who} ${text}`;
}

/**
 * Answer a recall question from the user's memories.
 * @param question the thing they asked (from the query action's title/raw text)
 * @param items the whole store; we search notes + events (things with lasting meaning)
 */
export async function searchMemory(question: string, items: Item[]): Promise<string> {
  if (!config.groqApiKey) {
    throw new Error('ยังไม่ได้ตั้งค่า Groq API key');
  }

  const memories = items.filter((i) => i.type === 'note' || i.type === 'event');
  if (memories.length === 0) {
    return 'ยังไม่มีบันทึกความทรงจำเลยครับ';
  }

  // Newest first; cap the context so a big diary still fits one request.
  const context = memories
    .sort((a, b) => (b.start_at ?? b.created_at).localeCompare(a.start_at ?? a.created_at))
    .slice(0, 200)
    .map(line)
    .join('\n');

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.groqApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.groq.llmModel,
      temperature: 0.1,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `บันทึกทั้งหมด:\n${context}\n\nคำถาม: ${question}` },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Groq memory search ล้มเหลว (${res.status}) ${detail}`.trim());
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return (data.choices?.[0]?.message?.content ?? 'ผมไม่พบบันทึกเรื่องนี้ครับ').trim();
}
