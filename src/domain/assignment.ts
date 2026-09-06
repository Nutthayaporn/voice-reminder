import type { Item } from '../store/types';
export interface SpaceMember { user_id: string; name: string }
export function assignmentPatch(item: Item, assignee: string | null | undefined, recipients: string[] | null | undefined, members: SpaceMember[]): Partial<Item> {
  const ids = new Set(members.map((m) => m.user_id));
  if (!item.household_id || (assignee && !ids.has(assignee)) || recipients?.some((id) => !ids.has(id))) throw new Error('Choose members of this space.');
  return { details: { ...item.details, ...(assignee !== undefined ? { assigned_to: assignee } : {}), ...(recipients !== undefined ? { notify_user_ids: recipients && [...new Set(recipients)] } : {}) } };
}
export function receivesAlert(item: Item, userId: string | null): boolean {
  const ids = item.details?.notify_user_ids;
  return !item.household_id || (!!userId && (ids == null || ids.includes(userId)));
}
