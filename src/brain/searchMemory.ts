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

const SYSTEM = `You are a personal memory assistant. Answer only from the provided notes.
- Reply in concise, natural English because the response will be spoken aloud.
- Include the date when a relevant note has one.
- Spell out weekday and month names. Never use date or time abbreviations.
- If no relevant information exists, reply: "I could not find a note about that."
- Never guess or invent information that is not in the notes.`;

/** Turn one item into a compact line for the retrieval context. */
function line(i: Item): string {
  const date = i.start_at
    ? new Intl.DateTimeFormat('en-US', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(i.start_at))
    : new Intl.DateTimeFormat('en-US', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(i.created_at));
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
    throw new Error('Groq API key is not configured.');
  }

  const memories = items.filter((i) => i.type === 'note' || i.type === 'event');
  if (memories.length === 0) {
    return 'There are no saved memories yet.';
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
        { role: 'user', content: `All notes:\n${context}\n\nQuestion: ${question}` },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Groq memory search failed (${res.status}) ${detail}`.trim());
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return (data.choices?.[0]?.message?.content ?? 'I could not find a note about that.').trim();
}
