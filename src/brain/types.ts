// "The Brain" contract — an ACTION PLAN, not a single intent.
//
// Key upgrade (from the ChatGPT design review): one utterance can map to
// MULTIPLE actions. "1–2 ก.ย. พ่อแม่ไปขายของ เตือนผมก่อน 1 วัน" =
// create_event + create_reminder. So the LLM returns a list of tool calls plus
// ONE combined spoken reply for the whole utterance.
//
// Params are kept as a flat superset (only the relevant ones are filled per
// tool) so parsing/rendering/routing stay trivial and adding a field is cheap.

export type ToolName =
  | 'create_reminder' // เตือน (มีเวลา, อาจซ้ำ)
  | 'create_event' // เหตุการณ์/นัด (อาจเป็นช่วง)
  | 'create_todo' // งานที่ต้องทำ (อาจไม่มีเวลา; อาจมี reminder แนบ)
  | 'create_note' // โน้ต/ไดอารี่ ผูกวันที่
  | 'record_expense' // บันทึกรายจ่ายไป daily-budget
  | 'query' // ถามข้อมูลย้อนกลับ (รายการของแอปนี้)
  | 'query_budget' // ถามสถานะงบของ daily-budget (ตอบด้วยเสียง)
  | 'update_expense' // แก้รายจ่ายใน daily-budget
  | 'delete_expense' // ลบรายจ่ายใน daily-budget
  | 'update_item' // แก้/เลื่อน/ทำเครื่องหมายเสร็จ ของรายการเดิม (ใช้ target_ref)
  | 'delete_item' // ยกเลิก/ลบรายการเดิม (ใช้ target_ref)
  | 'delete_items'; // ลบหลายรายการตามเงื่อนไข (ต้องยืนยันใน App ก่อน)

/** Which slice of the budget the user is asking about — shapes the answer. */
export type BudgetKind = 'today' | 'remaining' | 'status' | 'summary' | null;

export interface Recurrence {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  byday: Array<'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'> | null;
  interval: number;
}

/** How a timed reminder should get the user's attention. */
export type AlertMode = 'notification' | 'alarm';

/** Supported snooze choices shown in the app/native alarm UI. */
export type SnoozeMinutes = 5 | 10 | 30;

export type QueryKind = 'list_today' | 'list_range' | 'search' | null;
export type DeleteScope = 'past' | 'done' | 'all' | null;

export interface BrainAction {
  tool: ToolName;
  title: string;
  body: string | null;
  /** ISO 8601 (+07:00) — จุดเวลา/เวลาเริ่ม */
  datetime: string | null;
  /** ISO 8601 — เวลาสิ้นสุด (ช่วงวัน) */
  end_datetime: string | null;
  all_day: boolean;
  recurrence: Recurrence | null;
  /** เฉพาะ reminder/update_item; null = ใช้ notification ตามค่าเริ่มต้น */
  alert_mode: AlertMode | null;
  /** true = ปลุกซ้ำจนผู้ใช้กด "ทำแล้ว" (บังคับใช้ alarm mode) */
  remind_until_done: boolean | null;
  /** ระยะเวลาเลื่อนปลุก; รองรับ 5/10/30 นาที */
  snooze_minutes: SnoozeMinutes | null;
  /** จำนวนรอบเตือนรวม (รอบแรกนับเป็น 1) */
  max_attempts: number | null;
  /** เฉพาะ record_expense/update_expense (บาท) */
  amount: number | null;
  /** เฉพาะ query */
  query_kind: QueryKind;
  /** เฉพาะ query_budget — งบส่วนไหนที่ถาม */
  budget_kind: BudgetKind;
  /** เฉพาะ update_expense/delete_expense — "last" = รายจ่ายที่เพิ่งบันทึก/เมื่อกี้ */
  expense_ref: 'last' | null;
  /** เฉพาะ create_note — คนที่เกี่ยวข้อง (เช่น ["ลูก"]) ช่วยการค้นความทรงจำ */
  people: string[] | null;
  /** เฉพาะ update_item/delete_item — id ของรายการเดิม (จากรายการอ้างอิงที่ให้มา) */
  target_ref: string | null;
  /** เฉพาะ delete_items: past=เลยเวลา, done=ทำแล้ว, all=ทั้งหมด */
  delete_scope: DeleteScope;
  /** เฉพาะ update_item — ทำเครื่องหมายเสร็จ/ยังไม่เสร็จ */
  done: boolean | null;
}

export interface BrainPlan {
  /** ลำดับ action ที่จะทำ; ว่าง = ไม่มีคำสั่ง (คุยเล่น) */
  actions: BrainAction[];
  /** A short English sentence spoken back to the user (for example, "Done."). */
  speak_back: string;
  /** true เมื่อข้อมูลจำเป็นไม่ครบ/กำกวม — ต้องถามผู้ใช้ก่อน แทนการเดา */
  needs_clarification: boolean;
  /** A short English question to ask when needs_clarification is true. */
  clarify_question: string | null;
}

/** One thing the user could refer to next turn ("อันแรก", "อันเมื่อกี้"). */
export interface Referent {
  /** the item id — echoed back as target_ref */
  ref: string;
  /** short human label shown to the model, e.g. "ประชุมทีม — จ. 1 ก.ย. 10:00" */
  label: string;
}

/** Short-lived conversation memory passed into the next planning call. */
export interface BrainContext {
  referents: Referent[];
  /** Current store inventory, supplied every turn for commands by title. */
  inventory?: Referent[];
  lastUtterance?: string;
  /** an earlier utterance the brain asked to clarify — the next input completes it. */
  pending?: string;
}
