import type { BrainAction, ToolName } from './types';
export function emptyAction(tool: ToolName, title = ''): BrainAction {
  return { tool, title, body: null, datetime: null, end_datetime: null, all_day: false, recurrence: null,
    alert_mode: null, remind_until_done: null, snooze_minutes: null, max_attempts: null, amount: null,
    query_kind: null, budget_kind: null, expense_ref: null, people: null, target_ref: null, delete_scope: null, done: null };
}
