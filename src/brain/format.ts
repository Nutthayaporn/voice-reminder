// Human-readable rendering of brain actions for the preview card.

import type { BrainAction, Recurrence, ToolName } from './types';

const TZ = 'Asia/Bangkok';

export function toolLabel(tool: ToolName): string {
  switch (tool) {
    case 'create_reminder':
      return '⏰ เตือน';
    case 'create_event':
      return '📅 เหตุการณ์';
    case 'create_todo':
      return '☑️ งาน';
    case 'create_note':
      return '📝 โน้ต';
    case 'record_expense':
      return '💸 รายจ่าย';
    case 'query':
      return '🔍 คำถาม';
    case 'update_item':
      return '✏️ แก้ไข';
    case 'delete_item':
      return '🗑 ยกเลิก';
    default:
      return '❓';
  }
}

/** e.g. "อา. 31 ส.ค. 09:00 น." or "อา. 31 ส.ค. (ทั้งวัน)" */
export function formatDateTime(iso: string | null, allDay: boolean): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = new Intl.DateTimeFormat('th-TH', {
    timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short',
  }).format(d);
  if (allDay) return `${date} (ทั้งวัน)`;
  const time = new Intl.DateTimeFormat('th-TH', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
  return `${date} ${time} น.`;
}

const DAY_TH: Record<string, string> = {
  MO: 'จ.', TU: 'อ.', WE: 'พ.', TH: 'พฤ.', FR: 'ศ.', SA: 'ส.', SU: 'อา.',
};
const FREQ_TH: Record<Recurrence['freq'], string> = {
  daily: 'ทุกวัน', weekly: 'ทุกสัปดาห์', monthly: 'ทุกเดือน', yearly: 'ทุกปี',
};

export function formatRecurrence(r: Recurrence | null): string | null {
  if (!r) return null;
  const every = r.interval > 1 ? `ทุก ${r.interval} ` : '';
  if (r.freq === 'weekly' && r.byday?.length) {
    const days = r.byday.map((d) => DAY_TH[d] ?? d).join(' ');
    return `🔁 ${every}สัปดาห์: ${days}`.trim();
  }
  return `🔁 ${every ? `${every}(${FREQ_TH[r.freq]})` : FREQ_TH[r.freq]}`;
}

/** Rows of { label, value } describing one action, for the preview card. */
export function describeAction(a: BrainAction): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  const when = formatDateTime(a.datetime, a.all_day);
  const end = formatDateTime(a.end_datetime, a.all_day);
  if (when) rows.push({ label: 'เมื่อ', value: end ? `${when} – ${end}` : when });
  const rec = formatRecurrence(a.recurrence);
  if (rec) rows.push({ label: 'ซ้ำ', value: rec });
  if (a.amount != null) rows.push({ label: 'จำนวน', value: `${a.amount} บาท` });
  if (a.body) rows.push({ label: 'รายละเอียด', value: a.body });
  return rows;
}
