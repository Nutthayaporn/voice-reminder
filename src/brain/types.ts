// "The Brain" — the structured output the LLM must produce from a spoken line.
//
// One flat schema covers every intent; the LLM fills the relevant fields and
// nulls the rest. Flat (rather than a discriminated union per intent) keeps
// parsing/rendering trivial and makes adding a field a one-line change. The
// intent router (Phase 2) switches on `intent`.

export type Intent =
  | 'create_reminder' // เตือน (มีเวลา, อาจซ้ำ) — "พรุ่งนี้กินยา 9 โมง"
  | 'create_event' // เหตุการณ์/นัด (อาจเป็นช่วง) — "1–2 Sep พ่อแม่ไปขายของ"
  | 'create_note' // โน้ต/ไดอารี่ ผูกวันที่ — "วันนี้ลูกพูดได้"
  | 'query' // ถามข้อมูล — "วันนี้มีอะไรต้องทำบ้าง"
  | 'add_expense' // (อนาคต) ยิงไป daily-budget — "ซื้อโจ๊ก 60 บาท"
  | 'unknown'; // ตีความไม่ได้ / คุยเล่น

export interface Recurrence {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  /** สำหรับ weekly: วันในสัปดาห์ (MO..SU). null = ทุกวันตาม freq */
  byday: Array<'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'> | null;
  /** ทุก ๆ กี่หน่วย (เช่น interval 2 + weekly = สองสัปดาห์ครั้ง) */
  interval: number;
}

export type QueryKind = 'list_today' | 'list_range' | 'search' | null;

export interface BrainResult {
  intent: Intent;
  /** ป้ายสั้น ๆ ของรายการ */
  title: string;
  /** รายละเอียดเพิ่ม / เนื้อโน้ต */
  body: string | null;
  /** ISO 8601 พร้อม offset +07:00 — จุดเวลา/เวลาเริ่ม (reminder/event/note) */
  datetime: string | null;
  /** ISO 8601 — เวลาสิ้นสุด (สำหรับช่วง เช่น 1–2 Sep) */
  end_datetime: string | null;
  /** ทั้งวัน (ไม่เจาะเวลา) */
  all_day: boolean;
  /** กติกาการเกิดซ้ำ; null = ครั้งเดียว */
  recurrence: Recurrence | null;
  /** จำนวนเงิน (เฉพาะ add_expense) */
  amount: number | null;
  /** ประเภทของคำถาม (เฉพาะ query) ช่วยให้ Phase 3 ค้นได้ตรง */
  query_kind: QueryKind;
  /** ประโยคที่จะพูดตอบกลับผู้ใช้ (ภาษาไทย) */
  speak_back: string;
}
