// Human-readable rendering of brain actions for the preview card.

import type { BrainAction, Recurrence, ToolName } from './types';

const TZ = 'Asia/Bangkok';

export function toolLabel(tool: ToolName): string {
  switch (tool) {
    case 'assign_item': return 'ASSIGN';
    case 'set_occurrence': return 'REPEAT STATUS';
    case 'set_preference': return 'PREFERENCES';
    case 'find_free_time': return 'FREE TIME';
    case 'add_shopping':
      return 'SHOPPING';
    case 'remember_entity':
      return 'PERSON / PET / PLACE';
    case 'help':
      return 'HELP';
    case 'share_item':
      return 'SHARE';
    case 'create_reminder':
      return '⏰ REMINDER';
    case 'create_event':
      return '📅 EVENT';
    case 'create_todo':
      return '☑️ TODO';
    case 'create_note':
      return '📝 NOTE';
    case 'record_expense':
      return '💸 EXPENSE';
    case 'query':
      return '🔍 QUERY';
    case 'query_budget':
      return '💰 BUDGET';
    case 'update_expense':
      return '✏️ EDIT EXPENSE';
    case 'delete_expense':
      return '🗑 DELETE EXPENSE';
    case 'update_item':
      return '✏️ UPDATE';
    case 'delete_item':
      return '🗑 DELETE';
    case 'delete_items':
      return '🗑 BULK DELETE';
    default:
      return '❓';
  }
}

/** e.g. "Sun, Aug 31 · 09:00" or "Sun, Aug 31 (all day)" */
export function formatDateTime(iso: string | null, allDay: boolean): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short',
  }).format(d);
  if (allDay) return `${date} (all day)`;
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
  return `${date} · ${time}`;
}

const DAY_LABEL: Record<string, string> = {
  MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun',
};
const FREQ_LABEL: Record<Recurrence['freq'], string> = {
  daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly',
};
const FREQ_UNIT: Record<Recurrence['freq'], string> = {
  daily: 'days', weekly: 'weeks', monthly: 'months', yearly: 'years',
};

export function formatRecurrence(r: Recurrence | null): string | null {
  if (!r) return null;
  if (r.freq === 'weekly' && r.byday?.length) {
    const days = r.byday.map((d) => DAY_LABEL[d] ?? d).join(' ');
    const frequency = r.interval > 1 ? `Every ${r.interval} weeks` : 'Weekly';
    return `🔁 ${frequency}: ${days}`;
  }
  return r.interval > 1
    ? `🔁 Every ${r.interval} ${FREQ_UNIT[r.freq]}`
    : `🔁 ${FREQ_LABEL[r.freq]}`;
}

/** Rows of { label, value } describing one action, for the preview card. */
export function describeAction(a: BrainAction): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  const when = formatDateTime(a.datetime, a.all_day);
  const end = formatDateTime(a.end_datetime, a.all_day);
  if (when) rows.push({ label: 'When', value: end ? `${when} – ${end}` : when });
  const rec = formatRecurrence(a.recurrence);
  if (rec) rows.push({ label: 'Repeats', value: rec });
  if (
    a.tool === 'create_reminder' ||
    (a.tool === 'update_item' && (a.alert_mode || a.remind_until_done != null))
  ) {
    rows.push({
      label: 'Alert',
      value: a.remind_until_done
        ? '🔁 Until done'
        : a.alert_mode === 'alarm'
          ? '⏰ Alarm'
          : '🔔 Notification',
    });
  }
  if (a.snooze_minutes && (a.alert_mode === 'alarm' || a.remind_until_done)) {
    rows.push({ label: 'Snooze', value: `${a.snooze_minutes} minutes` });
  }
  if (a.remind_until_done && a.max_attempts) {
    rows.push({ label: 'Attempts', value: `${a.max_attempts} times` });
  }
  if (a.amount != null) rows.push({ label: 'Amount', value: `THB ${a.amount}` });
  if (a.delete_scope) {
    rows.push({
      label: 'Scope',
      value:
        a.delete_scope === 'past'
          ? 'Past items'
          : a.delete_scope === 'done'
            ? 'Completed items'
            : 'All items',
    });
  }
  if (a.body) rows.push({ label: 'Details', value: a.body });
  return rows;
}
