// Runs the planning LLM (Groq, JSON mode) and returns a normalised BrainPlan
// (a list of actions + one spoken reply). Validates defensively — an LLM can
// always return something unexpected.
//
// SECURITY: same caveat as cloudGroq — the key is bundled. Move server-side
// (Supabase Edge Function) before shipping.

import { entityKind } from '../knowledge/entities';
import { config } from '../config';
import { buildMessages } from './prompt';
import type {
  AlertMode,
  BrainAction,
  BrainContext,
  BrainPlan,
  BudgetKind,
  DeleteScope,
  QueryKind,
  Recurrence,
  SnoozeMinutes,
  ToolName,
} from './types';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

const VALID_TOOLS: ToolName[] = [
  'help',
  'share_item',
  'remember_entity',
  'add_shopping', 'assign_item', 'set_occurrence', 'set_preference', 'find_free_time',
  'create_reminder',
  'create_event',
  'create_todo',
  'create_note',
  'record_expense',
  'query',
  'query_budget',
  'update_expense',
  'delete_expense',
  'update_item',
  'delete_item',
  'delete_items',
];

export async function planActions(
  text: string,
  now: Date = new Date(),
  context?: BrainContext,
): Promise<BrainPlan> {
  if (!config.groqApiKey) {
    throw new Error('Groq API key is not configured (EXPO_PUBLIC_GROQ_API_KEY).');
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
      messages: buildMessages(text, now, context),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Groq LLM failed (${res.status}) ${detail}`.trim());
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return normalise(data.choices?.[0]?.message?.content ?? '{}');
}

export function normalise(raw: string): BrainPlan {
  let obj: Record<string, unknown> = {};
  try {
    obj = JSON.parse(raw);
  } catch {
    return {
      actions: [],
      speak_back: 'Sorry, I did not understand that. Please try again.',
      needs_clarification: false,
      clarify_question: null,
    };
  }

  const rawActions = Array.isArray(obj.actions) ? obj.actions : [];
  const actions = rawActions
    .map(coerceAction)
    .filter((a): a is BrainAction => a !== null);

  const needsClarify = obj.needs_clarification === true;
  const clarify = strOrNull(obj.clarify_question);
  const speak = str(obj.speak_back) || (actions.length ? 'Done.' : 'How can I help?');
  return {
    actions,
    speak_back: speak,
    // Only treat it as a real clarification if we actually have a question.
    needs_clarification: needsClarify && !!clarify,
    clarify_question: clarify,
  };
}

function coerceAction(v: unknown): BrainAction | null {
  if (!v || typeof v !== 'object') return null;
  const a = v as Record<string, unknown>;
  if (!VALID_TOOLS.includes(a.tool as ToolName)) return null;
  return {
    tool: a.tool as ToolName,
    assignee_id: a.assignee_id === undefined ? undefined : strOrNull(a.assignee_id),
    notify_user_ids: a.notify_user_ids === undefined ? undefined : a.notify_user_ids === null ? null : (stringArray(a.notify_user_ids) ?? []),
    occurrence_date: strOrNull(a.occurrence_date),
    occurrence_status: a.occurrence_status === 'done' || a.occurrence_status === 'skipped' || a.occurrence_status === 'pending' ? a.occurrence_status : null,
    preference_key: strOrNull(a.preference_key),
    preference_value: strOrNull(a.preference_value),
    duration_minutes: typeof a.duration_minutes === 'number' ? a.duration_minutes : null,
    list_name: strOrNull(a.list_name),
    quantity: typeof a.quantity === 'number' && Number.isFinite(a.quantity) && a.quantity > 0 ? a.quantity : null,
    unit: strOrNull(a.unit),
    parent_ref: strOrNull(a.parent_ref),
    entity_kind: entityKind(a.entity_kind),
    entity_refs: stringArray(a.entity_refs),
    aliases: stringArray(a.aliases),
    space_ref: strOrNull(a.space_ref),
    space_name: strOrNull(a.space_name),
    title: str(a.title),
    body: strOrNull(a.body),
    datetime: strOrNull(a.datetime),
    end_datetime: strOrNull(a.end_datetime),
    all_day: a.all_day === true,
    recurrence: recurrence(a.recurrence),
    alert_mode: alertMode(a.alert_mode),
    remind_until_done: typeof a.remind_until_done === 'boolean' ? a.remind_until_done : null,
    snooze_minutes: snoozeMinutes(a.snooze_minutes),
    max_attempts: maxAttempts(a.max_attempts),
    amount: typeof a.amount === 'number' ? a.amount : null,
    query_kind: queryKind(a.query_kind),
    budget_kind: budgetKind(a.budget_kind),
    expense_ref: a.expense_ref === 'last' ? 'last' : null,
    people: stringArray(a.people),
    target_ref: strOrNull(a.target_ref),
    delete_scope: deleteScope(a.delete_scope),
    done: typeof a.done === 'boolean' ? a.done : null,
  };
}

function stringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const arr = v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  return arr.length ? arr.map((s) => s.trim()) : null;
}

// ---- coercers ----------------------------------------------------------
function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
function strOrNull(v: unknown): string | null {
  const s = str(v);
  return s.length ? s : null;
}
function queryKind(v: unknown): QueryKind {
  return v === 'list_today' || v === 'list_range' || v === 'search' || v === 'briefing' || v === 'overdue' || v === 'shopping' ? v : null;
}
function budgetKind(v: unknown): BudgetKind {
  return v === 'today' || v === 'remaining' || v === 'status' || v === 'summary' ? v : null;
}
function deleteScope(v: unknown): DeleteScope {
  return v === 'past' || v === 'done' || v === 'all' ? v : null;
}
function alertMode(v: unknown): AlertMode | null {
  return v === 'notification' || v === 'alarm' ? v : null;
}
function snoozeMinutes(v: unknown): SnoozeMinutes | null {
  return v === 5 || v === 10 || v === 30 ? v : null;
}
function maxAttempts(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.max(1, Math.min(20, Math.round(v)))
    : null;
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
