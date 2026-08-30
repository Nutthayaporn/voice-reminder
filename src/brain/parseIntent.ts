// Runs the intent LLM (Groq, JSON mode) and returns a normalised BrainResult.
//
// Uses the same free Groq key as cloud STT. JSON mode (`response_format:
// json_object`) makes the model emit strictly parseable JSON; we still validate
// and fill defaults defensively because an LLM can always surprise you.
//
// SECURITY: same caveat as cloudGroq — the key is bundled. Move server-side
// (Supabase Edge Function) before shipping.

import { config } from '../config';
import { buildMessages } from './prompt';
import type { BrainResult, Intent, QueryKind, Recurrence } from './types';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

const VALID_INTENTS: Intent[] = [
  'create_reminder',
  'create_event',
  'create_note',
  'query',
  'add_expense',
  'unknown',
];

export async function parseIntent(text: string, now: Date = new Date()): Promise<BrainResult> {
  if (!config.groqApiKey) {
    throw new Error('ยังไม่ได้ตั้งค่า Groq API key (EXPO_PUBLIC_GROQ_API_KEY)');
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.groqApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.groq.llmModel,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: buildMessages(text, now),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Groq LLM ล้มเหลว (${res.status}) ${detail}`.trim());
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content ?? '{}';
  return normalise(raw, text);
}

/** Parse the model's JSON string and coerce it into a safe BrainResult. */
function normalise(raw: string, originalText: string): BrainResult {
  let obj: Record<string, unknown> = {};
  try {
    obj = JSON.parse(raw);
  } catch {
    // Model returned non-JSON despite json mode — degrade gracefully.
    return fallback(originalText, 'ขอโทษครับ ผมยังไม่เข้าใจ ลองพูดใหม่อีกครั้งได้ไหมครับ');
  }

  const intent: Intent = VALID_INTENTS.includes(obj.intent as Intent)
    ? (obj.intent as Intent)
    : 'unknown';

  return {
    intent,
    title: str(obj.title) || originalText,
    body: strOrNull(obj.body),
    datetime: strOrNull(obj.datetime),
    end_datetime: strOrNull(obj.end_datetime),
    all_day: obj.all_day === true,
    recurrence: recurrence(obj.recurrence),
    amount: typeof obj.amount === 'number' ? obj.amount : null,
    query_kind: queryKind(obj.query_kind),
    speak_back: str(obj.speak_back) || defaultSpeakBack(intent),
  };
}

function fallback(text: string, speak: string): BrainResult {
  return {
    intent: 'unknown',
    title: text,
    body: null,
    datetime: null,
    end_datetime: null,
    all_day: false,
    recurrence: null,
    amount: null,
    query_kind: null,
    speak_back: speak,
  };
}

function defaultSpeakBack(intent: Intent): string {
  switch (intent) {
    case 'create_reminder':
      return 'ตั้งเตือนให้แล้วนะครับ';
    case 'create_event':
      return 'บันทึกเหตุการณ์ให้แล้วนะครับ';
    case 'create_note':
      return 'จดบันทึกให้แล้วนะครับ';
    case 'query':
      return 'กำลังค้นหาให้นะครับ';
    case 'add_expense':
      return 'บันทึกรายจ่ายให้แล้วนะครับ';
    default:
      return 'รับทราบครับ';
  }
}

// ---- small coercers ----------------------------------------------------
function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
function strOrNull(v: unknown): string | null {
  const s = str(v);
  return s.length ? s : null;
}
function queryKind(v: unknown): QueryKind {
  return v === 'list_today' || v === 'list_range' || v === 'search' ? v : null;
}
function recurrence(v: unknown): Recurrence | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const freq = r.freq;
  if (freq !== 'daily' && freq !== 'weekly' && freq !== 'monthly' && freq !== 'yearly') {
    return null;
  }
  const days = Array.isArray(r.byday)
    ? (r.byday.filter((d) =>
        ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].includes(d as string),
      ) as Recurrence['byday'])
    : null;
  return {
    freq,
    byday: days && days.length ? days : null,
    interval: typeof r.interval === 'number' && r.interval > 0 ? r.interval : 1,
  };
}
