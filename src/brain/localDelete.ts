import type { BrainAction, BrainPlan, DeleteScope, Referent } from './types';
import { resolveDeleteTarget } from '../store/delete.ts';
import type { Item } from '../store/types';

/** Fast, deterministic path for common destructive voice commands. This makes
 * deletion reliable even when the LLM omits target_ref; unrecognised language
 * still falls through to the normal planner. */
export function planLocalDelete(
  text: string,
  items: Item[],
  conversationReferents: Referent[] = [],
): BrainPlan | null {
  const clean = normaliseSpeech(text);
  if (!clean.startsWith('ลบ')) return null;

  const scope = bulkScope(clean);
  if (scope) {
    return plan(
      deleteAction('delete_items', deleteScopeTitle(scope), null, scope),
      `Checking ${deleteScopeTitle(scope)}.`,
    );
  }

  const ordinalRef = resolveOrdinal(clean, conversationReferents, items);
  if (ordinalRef) {
    const target = items.find((item) => item.id === ordinalRef);
    if (target) return plan(deleteAction('delete_item', target.title, target.id, null), 'Item deleted.');
  }

  const spokenTitle = clean
    .replace(/^ลบ/, '')
    .replace(/^รายการ/, '')
    .replace(/^(ชื่อ|เรื่อง)/, '')
    .replace(/(ให้หน่อย|ที|ด้วย)?(ครับ|ค่ะ|คะ)?$/, '')
    .trim();
  const target = resolveDeleteTarget(spokenTitle, items);
  return target
    ? plan(deleteAction('delete_item', target.title, target.id, null), 'Item deleted.')
    : null;
}

function normaliseSpeech(value: string): string {
  return value
    .toLowerCase()
    .replace(/[“”"']/g, '')
    .replace(/\s+/g, '')
    .replace(/(ครับ|ค่ะ|คะ)$/, '')
    .trim();
}

function bulkScope(clean: string): Exclude<DeleteScope, null> | null {
  if (/^ลบ(?:รายการ)?(?:ที่)?(?:เลยไปแล้ว|เลยเวลาแล้ว|หมดเวลาแล้ว|ที่ผ่านมาแล้ว)$/.test(clean)) {
    return 'past';
  }
  if (/^ลบ(?:รายการ)?(?:ที่)?(?:ทำแล้ว|ทำเสร็จแล้ว|เสร็จแล้ว)$/.test(clean)) {
    return 'done';
  }
  if (/^ลบ(?:รายการ)?(?:ทั้งหมด|ทุกรายการ)$/.test(clean)) return 'all';
  return null;
}

function resolveOrdinal(clean: string, referents: Referent[], items: Item[]): string | null {
  const ordered = referents.length ? referents.map((referent) => referent.ref) : items.map((item) => item.id);
  if (/^ลบ(?:รายการ)?(?:อัน)?แรก$/.test(clean)) return ordered[0] ?? null;
  if (/^ลบ(?:รายการ)?(?:อัน)?(?:สุดท้าย|ล่าสุด)$/.test(clean)) return ordered.at(-1) ?? null;
  const match = clean.match(/^ลบ(?:รายการ)?(?:อัน)?ที่(\d+)$/);
  if (match) return ordered[Number(match[1]) - 1] ?? null;
  return null;
}

function deleteScopeTitle(scope: Exclude<DeleteScope, null>): string {
  if (scope === 'past') return 'past items';
  if (scope === 'done') return 'completed items';
  return 'all items';
}

function plan(action: BrainAction, speakBack: string): BrainPlan {
  return {
    actions: [action],
    speak_back: speakBack,
    needs_clarification: false,
    clarify_question: null,
  };
}

function deleteAction(
  tool: 'delete_item' | 'delete_items',
  title: string,
  targetRef: string | null,
  deleteScope: DeleteScope,
): BrainAction {
  return {
    tool,
    title,
    body: null,
    datetime: null,
    end_datetime: null,
    all_day: false,
    recurrence: null,
    alert_mode: null,
    remind_until_done: null,
    snooze_minutes: null,
    max_attempts: null,
    amount: null,
    query_kind: null,
    budget_kind: null,
    expense_ref: null,
    people: null,
    target_ref: targetRef,
    delete_scope: deleteScope,
    done: null,
  };
}
