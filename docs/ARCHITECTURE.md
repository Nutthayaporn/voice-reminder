# Architecture & design notes

เอกสารนี้เก็บ "การตัดสินใจเชิงออกแบบ" และแผนของ phase ถัดไป เพื่อให้คนมาทำต่อเข้าใจ
*เหตุผล* ไม่ใช่แค่ *โค้ด* — โค้ดอ่านเอาได้จาก `src/` แต่เหตุผลบางอย่างอ่านจากโค้ดไม่ออก

## 1. ทำไม voice-first และทำไมแยกเป็น layer

pain point ของเจ้าของแอป: อยากจดของ (ยา/นัด/todo/ไดอารี่) แต่มือไม่ว่าง เลยขี้เกียจพิมพ์
เป้าหมายคือ *แตะปุ่มเดียวแล้วพูด* — ทุกอย่างที่เหลือเป็นหน้าที่ระบบ

**การตัดสินใจสำคัญ (จากเจ้าของแอป):** ต้องเทียบ STT ได้ทั้ง cloud และ on-device
เพื่อทดลองสลับดูความแม่น/ความเร็ว/ค่าใช้จ่าย → จึงออกแบบ STT เป็น *สัญญากลาง* ที่มีหลาย
implementation สลับได้ที่ runtime (ดู `src/speech/`)

## 2. สัญญาของ speech layer

- **STT** — ทุก engine ป้อน transcript สุดท้ายเข้า `onResult(TranscriptResult)` เหมือนกัน
  ผู้เรียก (`App.tsx` วันนี้ / "the brain" ในอนาคต) ไม่ต้องรู้ว่ามาจาก engine ไหน
  - `cloud` (`cloudGroq.ts`): อัดเสียงด้วย `expo-audio` แล้ว POST ไฟล์ไป Groq Whisper
    เป็น *batch* (ได้ผลตอนหยุดพูด ไม่มี partial) ทำงานใน Expo Go ได้
  - `device` (`deviceStt.ts` + `useVoiceInput.ts`): `expo-speech-recognition` แบบ *streaming*
    มี partial ระหว่างพูด ผลสุดท้ายมาทาง event `end` — **ต้อง dev build**
  - `web` (`webStt.ts`): Web Speech API ของ browser แบบ streaming, ใช้ `th-TH`
    และไม่อัปโหลดไฟล์เสียง; แสดงเฉพาะ Browser engine บน web
- **สถานะ** เป็น state machine เล็ก ๆ: `idle → listening → transcribing → idle`
  (`transcribing` ใช้จริงเฉพาะ cloud เพราะต้องรออัพโหลด) — ดู `VoiceStatus` ใน `types.ts`
- **TTS** (`tts.ts`) แยกเป็นชิ้นของตัวเอง วันนี้ใช้เสียง OS (ฟรี มีเสียงไทย) เปลี่ยนเป็น
  cloud voice (ElevenLabs/OpenAI/Google) ทีหลังได้โดยไม่แตะผู้เรียก

### rules-of-hooks ที่ต้องระวัง
`useVoiceInput` mount hook ของทั้งสอง engine เสมอ (recorder ของ expo-audio + event ของ
speech-recognition) แล้วค่อย *แตกทางใน start()/stop()* เพราะ event ของ native มาแบบ async
เราจึงเก็บค่าล่าสุด (engine, callback, ข้อความ) ไว้ใน `useRef` เพื่ออ่านจาก callback ได้
โดยไม่เจอ stale closure

## 3. Phase 1 — "The Brain" (ยังไม่ทำ) 

> **สถานะ: ทำแล้ว + อัปเกรดเป็น Action Plan** — ดู `src/brain/` (`prompt.ts`,
> `planActions.ts`, `toItem.ts`, `format.ts`) เทสต์ด้วย `node scripts/test-brain.mjs`

**อัปเกรดสำคัญ (จาก design review กับ ChatGPT): 1 ประโยค → หลาย action.**
สมองไม่คืน intent เดียวแล้ว แต่คืน **action plan** = ลิสต์ของ tool call + คำพูดตอบรวม 1 ประโยค
เพราะประโยคเดียวอาจมีหลายคำสั่ง เช่น "1–2 ก.ย. พ่อแม่ไปขายของ **เตือนก่อน 1 วัน**" =
create_event + create_reminder. ชุด tool: `create_reminder`, `create_event`, `create_todo`,
`create_note`, `record_expense`, `query` (todo แยกจาก reminder — todo อาจไม่มีเวลา).
App เป็น router: วน execute ทุก action (save+schedule / query / expense handoff).

หลังได้ transcript ส่งเข้า Groq LLM (`openai/gpt-oss-120b`, ตั้งใน `config.groq.llmModel`)
แบบ **JSON mode** (`response_format: json_object`) คืน object เช่น:

> ⚠️ Groq ปลด/เปลี่ยนชื่อ model บ่อย — ถ้าเจอ 404 `model_not_found` ให้เช็ครุ่นที่ key
> ใช้ได้ด้วย `GET https://api.groq.com/openai/v1/models` แล้วอัปเดต `config.groq.llmModel`
> (เดิมวางไว้เป็น `llama-3.3-70b-versatile` แต่ key ปัจจุบันไม่มี จึงเปลี่ยนเป็น gpt-oss)

```jsonc
// input: "1 ถึง 2 กันยา พ่อแม่ไปขายของ เตือนผมก่อน 1 วัน"
{
  "actions": [
    { "tool": "create_event", "title": "พ่อแม่ไปขายของ",
      "datetime": "2026-09-01T00:00:00+07:00", "end_datetime": "2026-09-02T23:59:59+07:00",
      "all_day": true, "recurrence": null, "amount": null, "query_kind": null, "body": null },
    { "tool": "create_reminder", "title": "พ่อแม่ไปขายของ",
      "datetime": "2026-08-31T09:00:00+07:00", "end_datetime": null,
      "all_day": false, "recurrence": null, "amount": null, "query_kind": null, "body": null }
  ],
  "speak_back": "ได้ครับ เดี๋ยวเตือนก่อนหนึ่งวัน"
}
```

**สิ่งที่ต้องใส่ใน system prompt เสมอ:** วันที่/เวลาปัจจุบัน + `timezone: Asia/Bangkok`
เพื่อให้ตีความ "พรุ่งนี้ / เดือนนี้ / 1–2 Sep / ก่อน 1 วัน" เป็นวันจริงได้ถูก

App ทำหน้าที่ router: วน `plan.actions` แล้ว create_* → save+schedule, `query` → ตอบจาก
store (ทับ speak_back เพราะเป็น data-driven), `record_expense` → deep link ไป daily-budget

### 3b. Semantic memory (ไดอารี่ที่ถามย้อนหลังได้) — `src/brain/searchMemory.ts`

นี่คือ differentiator ที่ทำให้ต่างจาก Siri/Calendar: "ลูกเริ่มพูดได้เมื่อไหร่" ตอบได้แม้บันทึก
ใช้คำคนละคำ ("วันแรกที่ลูกพูด"). กลไก:
- ตอนบันทึก note: เก็บ `raw_text` (ประโยคเต็มที่พูด, verbatim) + `people[]` (สมองสกัดให้) ลง `Item`
- ตอนถาม: สมองตั้ง `query_kind="search"` → App เรียก `searchMemory(question, items)`
- **LLM-as-retriever** (ไม่ใช่ embedding): Groq **ไม่มี** embedding model และไดอารี่ส่วนตัวเล็ก
  (หลักสิบ-ร้อย) จึงส่งบันทึกทั้งหมด (cap 200 รายการล่าสุด) + คำถามให้ gpt-oss หาคำตอบ ถูก
  กว่าและง่ายกว่าการตั้ง vector store — **swap เป็น embedding index ทีหลังได้ที่ signature เดิม**
- ถ้าไม่พบ ตอบ "ไม่พบบันทึก" (prompt สั่งห้ามเดา) — กัน hallucination
- เทสต์: `node scripts/test-memory.mjs` (มี fake diary ในตัว)

### 3c. Multi-turn context (อ้างถึงรายการเดิม) — `update_item` / `delete_item`

ให้พูดต่อเนื่องแบบคน: "เลื่อนอันแรกไป 11 โมง", "ยกเลิกอันเมื่อกี้", "จ่ายเน็ตแล้ว". กลไก:
- App เก็บ `contextRef: BrainContext` (ใน `useRef`, ไม่ trigger render) = **referents** ของเทิร์นก่อน
  — รายการที่ผู้ใช้อ้างถึงได้ พร้อม `ref`=item id และ label (รวม ISO ใน `{...}` เพื่อให้แก้เวลา
  โดยคงวันเดิมได้). อัปเดตท้ายทุกเทิร์น: ถ้าเพิ่ง list → referents = ผลลิสต์ (เรียงตามที่พูด),
  ไม่งั้น = ของที่เพิ่งสร้าง, ไม่งั้น = item ล่าสุด
- ส่ง referents เข้า prompt ทุกครั้ง (`buildMessages(text, now, context)`) สมองแปล "อันแรก"=ลำดับ1,
  "อันเมื่อกี้"=ล่าสุด, หรือจับจากชื่อ → คืน `update_item`/`delete_item` พร้อม `target_ref`
- App resolve `target_ref` → item จริง แล้ว **reschedule notification** ถ้าเวลา/recurrence เปลี่ยน
  (cancel ของเก่าก่อน กันเด้งซ้ำ). done=true = ทำเครื่องหมายเสร็จ ("จ่ายเน็ตแล้ว")
- เทสต์: `node scripts/test-context.mjs`
- ยังเป็น context แบบ 1 เทิร์น (referents ล่าสุด) พอสำหรับ use case จริง; ยังไม่เก็บ transcript
  ประวัติยาว — ถ้าต้องอ้างข้ามหลายเทิร์นค่อยขยาย

### 3d. Confirmation เมื่อไม่มั่นใจ — `needs_clarification`

ไม่เดาเวลาเมื่อผู้ใช้บอกกว้าง ("เตือนกินยาเช้า"). กลไก (ออกแบบให้ **ไม่ถามพร่ำเพรื่อ** — ถาม
เฉพาะ create_reminder ที่เวลากว้างจริง ๆ):
- สมองคืน `needs_clarification=true` + `clarify_question` ("ประมาณกี่โมงครับ"), `actions=[]`
- App พูดคำถาม แล้วเก็บประโยคเดิมไว้ใน `contextRef.pending` (ไม่ execute)
- เทิร์นถัดไป ("8 โมง") ส่ง pending เข้า prompt → สมอง "รวม" pending+คำตอบ เป็น action สมบูรณ์
  (`needs_clarification=false`) → App execute แล้ว pending ถูกล้างอัตโนมัติ (executePlan reset context)
- เทสต์: `node scripts/test-brain.mjs "เตือนกินยาพรุ่งนี้เช้า"` (ต้องถาม), เวลาที่ชัดจะไม่ถาม
- ทางต่อยอด (ChatGPT แนะ): เรียนรู้ default ของผู้ใช้ (เช่น "เช้า"=08:00) แล้วเลิกถาม

## 4. Phase 2 — Data model + การเตือน

> **สถานะ: ทำแล้ว (local-first + optional cloud sync)** — เก็บด้วย zustand + AsyncStorage ใน
> `src/store/useStore.ts` (record = `Item` ใน `src/store/types.ts`), แปลงจาก intent
> ด้วย `src/brain/toItem.ts`, ตั้งเตือนด้วย `expo-notifications` ใน `src/notify/`.
> Cloud sync ใช้ optional Supabase client + email OTP, persisted offline write queue,
> soft delete, Realtime/foreground pull และ last-write-wins ด้วย `updated_at`. ดู
> `src/store/cloud.ts`, `src/store/useStore.ts` และ `supabase/migrations/`. ถ้าไม่ตั้ง env หรือ
> ไม่ sign in จะเป็น local-only เหมือนเดิม. **การเตือนจริงต้อง dev build**
> (Expo Go จะ save ได้แต่ไม่ยิงเตือน)

ตัดสินใจใช้ **ตารางเดียว `items`** แยกชนิดด้วยคอลัมน์ `type` (ตามที่เจ้าของแอปเลือก —
ไม่แยกตาราง holidays; วันหยุดก็คือ item ชนิดหนึ่ง). Schema จริงพร้อม RLS/LWW functions อยู่ที่
`supabase/migrations/20260831000000_items_sync.sql`; `notificationIds` ไม่ขึ้น cloud เพราะแต่ละ
เครื่องต้อง schedule/cancel notification ของตัวเอง

```sql
create table items (
  id          text not null,           -- รองรับ ID ของ local records เดิม
  user_id     uuid references auth.users,
  type        text not null,           -- reminder/event/todo/note
  title       text not null,
  start_at    timestamptz,
  recurrence  jsonb,
  updated_at  timestamptz not null,    -- LWW conflict key
  deleted_at  timestamptz,             -- soft-delete tombstone
  primary key (user_id, id)
);
```

- ต่อ Supabase ด้วยแพตเทิร์นเดียวกับ daily-budget (`src/lib/supabase.ts` ที่ client เป็น
  `null` เมื่อยังไม่ตั้งค่า → แอปยัง demo ได้แบบ local)
- การเตือนจริงใช้ `expo-notifications` — recurring/ยกเว้นวันหยุด map จาก `recurrence`
  ไปเป็น scheduled local notifications (ต้อง dev build เช่นกัน)

## 5. Phase 4 — Integrate กับ daily-budget

> **สถานะ: ทำแล้ว (แบบ deep link)** — `src/integrations/dailyBudget.ts`

เมื่อพูด "ซื้อโจ๊ก 60 บาท" → intent `add_expense` (สมองดึง `amount` + `title` + วันที่ให้)
→ ยิง **deep link** `dailybudget://entry?amount=60&note=โจ๊ก&date=YYYY-MM-DD&type=expense`
เปิดหน้าเพิ่มรายการของ daily-budget แบบกรอกค่าให้พร้อม (หน้า `entry.tsx` ของมันรับ params
เหล่านี้อยู่แล้ว) ผู้ใช้กดบันทึกยืนยัน

**ทำไมเลือก deep link (ไม่ใช่ insert เข้า DB ตรง):** daily-budget เป็น local-first และ
Supabase ของมันมี RLS ผูก `auth.uid()` + `space_members` การ insert ตรงต้อง login เป็น user
เดียวกัน + resolve space/category — หนักและบังคับตั้ง auth ข้ามแอป. deep link decouple กว่า
ใช้ได้ทันทีบนเครื่องเดียว และให้ผู้ใช้ยืนยันการบันทึก (ปลอดภัยกับเรื่องเงิน)

iOS ต้องมี `dailybudget` ใน `LSApplicationQueriesSchemes` (ตั้งใน app.json แล้ว) เพื่อให้
`Linking.canOpenURL` ทำงาน. **อนาคต** ถ้าอยากให้บันทึกอัตโนมัติไม่ต้องกดยืนยัน: เพิ่ม route
ใน daily-budget ที่ save ทันทีจาก deep link, หรือทำ Edge Function ให้ voice-reminder ยิง HTTP
ตรง — เปลี่ยนแค่ transport ใน `sendExpenseToDailyBudget` โดยไม่แตะ caller

## 6. ค่าใช้จ่าย / provider ที่เลือก

- **Groq** ฟรี tier ใช้ได้ทั้ง Whisper (STT) และ LLM (สมอง) ด้วย key เดียว เร็วมาก
- **on-device** ใช้ของฟรีในเครื่อง (ไม่มีค่า API, ออฟไลน์ได้)
- **TTS** วันนี้ใช้เสียง OS ฟรี — ถ้าอยากได้เสียงธรรมชาติกว่านี้ค่อยเสียบ cloud TTS

## 7. เรื่องต้องระวัง (gotchas)

- อย่าตั้ง `Content-Type` เองตอน POST multipart ไป Groq — ปล่อยให้ `fetch` ใส่ boundary
- Groq API key ถูกฝังใน bundle (EXPO_PUBLIC_) → ก่อน release ย้ายไป Edge Function
- on-device STT + notifications ต้อง **dev build** ไม่ใช่ Expo Go
- **ห้าม static import `expo-speech-recognition`** — package มัน `requireNativeModule()`
  ตอนโหลด ซึ่ง *throw ใน Expo Go แล้วทำแอปพังทั้งตัว* (แม้แต่ฝั่ง cloud). ต้องเข้าถึง
  native module ผ่าน `requireOptionalNativeModule('ExpoSpeechRecognition')` (คืน `null`
  เมื่อไม่มี) และ subscribe event ด้วย `module.addListener(...)` เอง — ดู `deviceStt.ts`
- Whisper รับ `language=th` ช่วยความแม่น อย่าลืมส่ง
- notification trigger แบบ recurring (WEEKLY/DAILY) ใช้ **เวลาท้องถิ่นของเครื่อง** —
  โค้ดสมมติเครื่องอยู่ Asia/Bangkok. ถ้าจะรองรับข้าม timezone ต้องแปลงเพิ่ม
- expo-notifications: **ต้อง dev build** ถึงจะยิงเตือนจริง; ใน Expo Go save ได้แต่ไม่เตือน
- บน web ใช้ platform files (`*.web.ts`) ตัด `expo-notifications` และ native file uploader
  ออกจาก bundle; items บันทึกได้แต่ยังไม่มี Web Push
