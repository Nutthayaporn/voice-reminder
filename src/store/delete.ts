import type { DeleteScope } from '../brain/types';
import type { Item } from './types';

/** Resolve a bulk-delete request deterministically instead of trusting the LLM
 * to enumerate every item ID. Recurring items never count as "past" because
 * they can still have future occurrences. */
export function itemsForDeleteScope(
  items: Item[],
  scope: DeleteScope,
  now: Date = new Date(),
): Item[] {
  switch (scope) {
    case 'past':
      return items.filter((item) => {
        if (item.recurrence || !item.start_at) return false;
        const end = item.end_at ?? item.start_at;
        let timestamp = Date.parse(end);
        // A one-day all-day item starts at midnight but remains current until
        // the end of that Bangkok calendar day.
        if (item.all_day && !item.end_at) timestamp += 24 * 60 * 60 * 1000 - 1;
        return Number.isFinite(timestamp) && timestamp < now.getTime();
      });
    case 'done':
      return items.filter((item) => item.done);
    case 'all':
      return [...items];
    default:
      return [];
  }
}

export function isDeleteConfirmation(text: string): boolean {
  const clean = text.trim().toLowerCase();
  return /^(ยืนยัน(การลบ)?|ลบเลย|ตกลง|โอเค|ใช่|ok|confirm)(ครับ|ค่ะ|คะ)?$/.test(clean);
}

export function isDeleteCancellation(text: string): boolean {
  const clean = text.trim().toLowerCase();
  return /^(ยกเลิก|ไม่ลบ|ไม่ต้องลบ|ไม่เอา|cancel)(ครับ|ค่ะ|คะ)?$/.test(clean);
}

export function deleteScopeLabel(scope: DeleteScope): string {
  if (scope === 'past') return 'past items';
  if (scope === 'done') return 'completed items';
  return 'all items';
}

/** Defensive fallback when the model understood the title but omitted or
 * hallucinated target_ref. Only resolves a unique match, never guesses among
 * multiple similar records. */
export function resolveDeleteTarget(title: string, items: Item[]): Item | null {
  const needle = normaliseTitle(title);
  if (!needle) return null;
  const exact = items.filter((item) => normaliseTitle(item.title) === needle);
  if (exact.length === 1) return exact[0];
  const partial = items.filter((item) => {
    const candidate = normaliseTitle(item.title);
    return candidate.includes(needle) || needle.includes(candidate);
  });
  return partial.length === 1 ? partial[0] : null;
}

function normaliseTitle(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '').trim();
}
