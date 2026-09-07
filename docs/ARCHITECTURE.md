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
- **Talk auto-listen** เป็น one-shot controller ใน `App.tsx`:
  ครั้งแรกของ app session คือ `permission → greeting → listening → processing → speaking → idle`;
  การกลับเข้า Talk ครั้งถัดไปจะข้าม greeting แล้วเริ่ม listening เลย. ค่า greeted อยู่ใน memory
  ตลอดอายุ component จึงรีเซ็ตเฉพาะเมื่อปิด/เปิดแอปใหม่ ไม่รีเซ็ตเมื่อสลับแท็บหรือกลับจาก background.
  ทุกครั้งทำงานโดยไม่อ่าน Hands-free preference และยกเลิกเมื่อเปลี่ยนแท็บหรือเข้า background.
- **Hands-free conversation** เป็น preference แยก (default `false`) ซึ่งเปิดไมค์อีกครั้ง
  หลัง AI ตอบ ผู้ใช้เปิดปิดได้ทั้งจากหน้า Talk และ Settings.
  Cloud ใช้ metering ของ `expo-audio` เป็น VAD, วัด noise floor ช่วง 600 ms แรกเพื่อไม่ให้
  เสียงทีวี/พัดลมถูกนับเป็นเสียงพูดค้าง แล้วหยุดหลังเงียบ 1.2 วินาที; device/web ใช้
  natural endpoint ของ recognizer ร่วมกับ silence hint/timer. Preference `autoStopEnabled`
  (default `true`) ใช้ปิด
  endpoint อัตโนมัติได้; เมื่อปิด cloud จะไม่รัน VAD และ device/web จะใช้ continuous mode
  เพื่อรอให้ผู้ใช้แตะ Stop. Tap-to-talk ยังคงใช้ `start/stop/toggle` ชุดเดิม.
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

### 3e. Voice delete: inventory + bulk confirmation

ทุกเทิร์น App แนบ inventory ปัจจุบัน (สูงสุด 200 รายการ) แยกจาก referents ของบทสนทนาก่อน
เพื่อให้ “ลบนัดหมอ” ทำงานได้แม้ไม่ได้ถามรายการก่อน. `delete_item` ใช้กับรายการเดียวและต้องมี
`target_ref`; `delete_items` ใช้ `delete_scope=past|done|all` และ App resolve IDs แบบ
deterministic ผ่าน `src/store/delete.ts`. Bulk delete ไม่ execute ทันที: App จำ IDs ณ ตอนขอ
และรอผู้ใช้พูด “ยืนยัน” หรือ “ยกเลิก”. รายการ recurring ไม่นับเป็น past และ all-day จะถือว่า
หมดเวลาเมื่อจบวัน ไม่ใช่ตอน 00:00

## 4. Phase 2 — Data model + การเตือน

> **สถานะ: ทำแล้ว (local-first + optional cloud sync)** — เก็บด้วย zustand + AsyncStorage ใน
> `src/store/useStore.ts` (record = `Item` ใน `src/store/types.ts`), แปลงจาก intent
> ด้วย `src/brain/toItem.ts`, ตั้งเตือนผ่าน router ใน `src/notify/` ซึ่งเลือก notification
> หรือ native alarm ตาม `alert_mode`.
> Cloud sync ใช้ optional Supabase client + email/password หรือ Google/Facebook OAuth,
> persisted offline write queue,
> soft delete, Realtime/foreground pull และ last-write-wins ด้วย `updated_at`. ดู
> `src/store/cloud.ts`, `src/store/useStore.ts` และ `supabase/migrations/`. ถ้าไม่ตั้ง env หรือ
> ไม่ sign in จะเป็น local-only เหมือนเดิม. **การเตือนจริงต้อง dev build**
> (Expo Go จะ save ได้แต่ไม่ยิงเตือน)

ค่า UI ที่เป็นพฤติกรรมเฉพาะเครื่อง (`preferredEngine`, `defaultAlertMode`,
`activeHouseholdId`) แยกเก็บใน `src/store/usePreferences.ts`. ถ้า action reminder ไม่ได้ระบุ
`alert_mode` ชัดเจน `actionToItem` จะใช้ default ของผู้ใช้; ถ้าพูดว่า “ปลุก” หรือ “แจ้งเตือน”
ค่าที่สมองคืนมายังชนะ default เสมอ

### 4b. Shared household

Migration `20260831030000_shared_households.sql` เพิ่ม `households`, `household_members` และ
`items.household_id`. รายการที่ `household_id=null` ยังเป็นส่วนตัว; รายการที่มี household จะอ่าน
และแก้ไขได้โดยสมาชิกทุกคนผ่าน RLS. Invite code ใช้สำหรับ join เท่านั้นและทุก RPC ตรวจ
`auth.uid()`. `items.id` เปลี่ยนเป็น conflict key เดี่ยวเพื่อให้สมาชิกคนอื่น upsert แถวที่ไม่ได้
เป็นผู้สร้างได้ โดย `user_id` เดิมยังเก็บผู้สร้างรายการไว้

Migration `20260906000000_household_invite_links.sql` เพิ่ม RPC สำหรับ preview ชื่อพื้นที่ก่อน
ยืนยัน join. UI ส่ง code ภายใน invite URL, รับได้ทั้ง cold start และขณะเปิดแอป, และเก็บ pending
invite ใน AsyncStorage ระหว่าง sign-in. Native ใช้ `voicereminder://join?code=…` เป็นค่าเริ่มต้น;
Expo Go ใช้ development URL; web ใช้ origin ปัจจุบัน. เมื่อตั้ง
`EXPO_PUBLIC_INVITE_BASE_URL` ทุกแพลตฟอร์มจะ share HTTPS URL ของ PWA แทน โดยช่องกรอก code
เดิมยังคงอยู่เป็น fallback. การเปิดลิงก์ไม่ join ทันที—ผู้ใช้ต้องเห็นชื่อพื้นที่และยืนยันก่อนเสมอ

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
  alert_mode  text not null default 'notification', -- notification/alarm
  remind_until_done boolean not null default false,
  snooze_minutes integer not null default 10,         -- 5/10/30
  max_attempts integer not null default 5,            -- รวมรอบแรก
  updated_at  timestamptz not null,    -- LWW conflict key
  deleted_at  timestamptz,             -- soft-delete tombstone
  primary key (user_id, id)
);
```

- ต่อ Supabase ด้วยแพตเทิร์นเดียวกับ daily-budget (`src/lib/supabase.ts` ที่ client เป็น
  `null` เมื่อยังไม่ตั้งค่า → แอปยัง demo ได้แบบ local)
- `src/lib/auth.ts` เปิด social OAuth ผ่าน system browser; native กลับเข้ามาทาง
  `voicereminder://auth/callback` ส่วน web กลับ URL เดิมและให้ Supabase อ่าน session จาก URL
- แต่ละ reminder มี `alert_mode`: `notification` (ค่าเดิม/default) หรือ `alarm`
- `remind_until_done=true` คือระดับที่สามใน UI (`UNTIL DONE`) และบังคับ `alert_mode=alarm`;
  ค่าปกติคือ Snooze 10 นาที รวมสูงสุด 5 รอบ
- `notification` ใช้ `expo-notifications`; `alarm` ใช้ Expo local module ที่
  `modules/voice-alarm/` — Android ใช้ `AlarmManager.setAlarmClock()` + foreground ringing
  service + full-screen ทำแล้ว/Stop/Snooze, ส่วน iOS 26+ ใช้ AlarmKit Repeat
- Android เก็บ Snooze chain ข้าม reboot และส่ง item id ที่กด "ทำแล้ว" กลับ JS ตอนแอป active;
  แอปจึง mark done + cancel รอบที่เหลือได้แม้ตอนกดปุ่ม JS ถูก suspend
- AlarmKit ใช้ `postAlert` เป็นระยะ Snooze และ stop intent เพื่อส่งสถานะทำแล้วกลับแอป;
  จำนวน Repeat สูงสุดบน iOS เป็นพฤติกรรมที่ระบบจัดการ จึงยังบังคับ cap แบบ Android ไม่ได้
- AlarmKit รองรับ one-shot/daily/weekly ใน implementation นี้; monthly/yearly และ iOS < 26
  fallback เป็น Time Sensitive notification. รายการ one-shot แบบ Until Done จะเตรียม
  notification หลายรอบตาม `snooze_minutes`/`max_attempts` ถ้า native alarm ใช้ไม่ได้
- schedule IDs ไม่ sync: prefix `alarm:` คือ native alarm, `notification:` คือ Expo notification
  ทำให้ update/delete cancel backend ที่ถูกต้องได้

## 5. Phase 4 — Integrate กับ daily-budget

> **สถานะ: ทำแล้ว (REST bridge + deep-link fallback)** — `src/integrations/budgetApi.ts`
> (REST) และ `src/integrations/dailyBudget.ts` (deep link, fallback)

เดิมทำเป็น **deep link** ทางเดียว (`dailybudget://entry?...`) ซึ่งบันทึกรายจ่ายได้แต่ *ตอบกลับ
ไม่ได้* — ถามงบด้วยเสียงไม่ได้. เจ้าของแอปเลือกยกระดับเป็น **REST API** (จากตัวเลือก
"rest api หรือ mcp") เพื่อให้ voice-reminder ทั้ง **ถามสถานะงบ + บันทึก + แก้ไข/ลบรายจ่าย**
ได้ครบและตอบด้วยเสียงในแอปเดียว โดยไม่ต้องสลับแอป

**ทำไม REST (ไม่ใช่ shared Supabase read):** สองแอปอยู่คนละ Supabase project (voice-reminder
`rvkoza…`, daily-budget `zphzhc…`) → voice-reminder ออก JWT ที่ผ่าน RLS ของ daily-budget ไม่ได้.
วิธีที่สะอาดคือ Edge Function บน project ของ daily-budget ที่ยืนยันตัวด้วย **shared token** แล้ว
ใช้ service-role อ่าน/เขียน **หนึ่ง space** ที่ตั้งค่าไว้แทนเจ้าของ

**Edge Function:** `daily-budget/supabase/functions/budget-api/index.ts` — POST JSON `{action,…}`
รองรับ `summary` (สรุปงบเดือน คำนวณด้วย port ของ `src/domain/analytics.ts`), `list`,
`add_expense`, `update_expense`, `delete_expense`. Auth = `Authorization: Bearer <VOICE_API_TOKEN>`.
Space resolve จาก secret `VOICE_API_SPACE_ID` หรือ `VOICE_API_OWNER_EMAIL`

**ฝั่ง voice-reminder:** สมองเพิ่ม tool `query_budget` (มี `budget_kind`: today/remaining/status/
summary), `update_expense`, `delete_expense`; `record_expense` เดิมตอนนี้ยิงเข้า API ก่อน (ถ้า
ตั้งค่าไว้) ตกลงมาที่ deep link เมื่อ API ไม่พร้อม. App จำ `lastExpenseIdRef` ของรายจ่ายที่เพิ่ง
บันทึก เพื่อให้ "แก้เมื่อกี้เป็น 45" / "ลบอันเมื่อกี้" (expense_ref="last") ทำงานได้; อ้างด้วยชื่อ/ยอด
ก็จับคู่จาก `list` ได้ คำตอบทั้งหมดจัดรูปที่ `formatBudgetAnswer` (อังกฤษ ให้เข้าชุด speak_back)

### 5b. Multi-user: OAuth 2.0 (Authorization Code + PKCE)

> **สถานะ: ทำแล้ว** — daily-budget เป็น authorization server; voice-reminder เป็น OAuth client

shared-token ด้านบนคือโหมด *ผู้ใช้คนเดียว* (fix space ด้วย secret). สำหรับ "ใครใช้ก็ได้ ต่างคน
ต่างเชื่อมบัญชีตัวเอง" daily-budget ทำหน้าที่เป็น **OAuth 2.0 provider** เต็มรูปแบบ (grant =
authorization code + PKCE S256, public client ไม่มี secret):

- **Authorization endpoint = หน้า consent ในแอป** `daily-budget/app/connect.tsx` เปิดผ่าน deep link
  `dailybudget://connect?client_id&redirect_uri&scope&state&code_challenge&…` ผู้ใช้ (ล็อกอินบัญชี
  ตัวเองอยู่แล้ว) กด "อนุญาต" → RPC `oauth_issue_code()` (SECURITY DEFINER, รันเป็น `auth.uid()`)
  ออก **authorization code** ผูกกับ user + space ที่ผู้ใช้เป็นเจ้าของ แล้ว redirect กลับ
  `voicereminder://budget-oauth?code&state`
- **Token endpoint** = Edge Function `oauth-token` แลก code (+ PKCE verifier) เป็น **access JWT**
  (HS256 ด้วย `OAUTH_JWT_SECRET`, อายุ 1 ชม., claims: sub/space_id/scope) + **refresh token**
  (opaque, เก็บเฉพาะ SHA-256 hash, rotate ทุกครั้งที่ refresh)
- **Revocation** = Edge Function `oauth-revoke` (RFC 7009) + หน้า `app/connections.tsx` ให้ผู้ใช้ดู/
  เพิกถอน "แอปที่เชื่อมต่อ" (ลบแถว `oauth_tokens` ผ่าน RLS owner-delete)
- **Resource server** = `budget-api` ตรวจ access JWT (ลายเซ็น + exp + `scope`: read สำหรับ summary/
  list, write สำหรับ add/update/delete) แล้วใช้ `space_id` จาก claims — ยังรับ shared token เดิมเป็น
  legacy fallback
- schema: `oauth_clients` / `oauth_authorization_codes` / `oauth_tokens` +
  migration `20260902000000_oauth_provider.sql`
- **ฝั่ง voice-reminder:** `src/integrations/budgetOAuth.ts` (PKCE + expo-crypto, เก็บ token ใน
  AsyncStorage, auto-refresh), ปุ่ม "Connect Daily Budget" ในหน้า Settings, และ `budgetApi.ts`
  แนบ access token อัตโนมัติ (getAccessToken → refresh) แทน shared token

**ทำไมไม่สร้าง OAuth server จากศูนย์แบบมี /authorize เป็นเว็บ + JWKS:** Supabase Auth ไม่ใช่ OAuth
provider จึงต้องเขียน authorization server เอง เราเลือกทำ authorize เป็น *หน้า consent ในแอป* (reuse
login เดิม) + token/refresh/revoke เป็น Edge Functions ซึ่งคือ authorization-code grant ครบสมบูรณ์
สำหรับ mobile first-party. ใช้ HS256 + shared secret (resource server กับ auth server เป็นเจ้าของ
เดียวกัน); ถ้าอนาคตมี third-party resource server ค่อยสลับเป็น RS256 + JWKS

**ข้อกำหนด/ปลอดภัย:** ต้องเปิด cloud sync + login ใน daily-budget (ไม่งั้นไม่มีข้อมูลใน Supabase ให้
อ่าน). `OAUTH_JWT_SECRET` ตั้งเป็น Edge Function secret ระดับ project (ใช้ร่วม oauth-token +
budget-api). access token อายุสั้น + refresh rotate + เพิกถอนได้ ทำให้ปลอดภัยกว่า shared token แบบ
ฝังใน bundle. **อนาคต** ห่อ budget-api เป็น MCP tool ให้ agent เรียกได้ก็ได้โดยไม่แตะ logic

iOS ยังมี `dailybudget` ใน `LSApplicationQueriesSchemes` (app.json) ไว้สำหรับ deep-link fallback

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
- native alarm: **ต้อง dev build**; ใน Expo Go จะ fallback ไป notification ตาม capability
- บน web ใช้ platform files (`*.web.ts`) ตัด `expo-notifications` และ native file uploader
  ออกจาก bundle; Web Push ใช้ service worker และ Supabase scheduler แยกจาก native


## 8. Structured properties and scoped planning (2026-09-07)

`items.details` is an additive JSON object persisted by `upsert_item_lww(p_details)`; omitted details from old clients preserve the existing value. Migration `20260907000000_item_details.sql` retains the existing item RLS policies. Details currently contain entity profiles, linked entity IDs, parent reminder links/offsets and shopping quantity/unit/list metadata.

The planner receives current accessible Space IDs/names/aliases and entity profiles. Execution validates IDs, named-space ambiguity, link ownership and target scope before applying local actions. Private/shared visibility is per item; default queries and deletes use the selected Space. Space and entity aliases are account-keyed local preferences. Household RPC data is account-bound and refreshed before shared writes; missing membership fails closed.

`linkedPatches` propagates parent date/completion/visibility changes to child reminders, and the store reschedules them before publishing updates. Parent deletion removes linked reminders in the same Space. Bulk confirmation stores the account, original item IDs and scopes; a changed linked family requires a new delete request.

The help guide and help intent share `src/help/capabilities.ts`. Structured entity editing is in Settings → Memory. Daily briefing and shopping queries are deterministic; the LLM only selects their intent and parameters. See the rollout document for remaining features and verification limits.


## Remaining rollout (7–13)

- `items.details.assigned_to` is an optional member ID. `notify_user_ids=null/absent` means all current Space members, `[]` means nobody. Neither changes item visibility. Member lookup is membership-checked; scheduler rechecks recipients. Personal delivery belongs only to the record owner.
- `details.occurrences` maps Bangkok `YYYY-MM-DD` to `done|skipped`; deleting a key reopens it. The series stays active. `src/domain/recurrence.ts` is shared with the Edge Function and handles interval-aware occurrence dates. Native exception schedules are rolling, up to eight occurrences in ten years; reopening replenishes the queue. Calendar cells now include recurring dates.
- Account-local `personalDefaults` stores named times, optional lead minutes, and response language. Planner context supplies those values; deterministic replies and TTS follow the language. This is response localization, not a translation of all UI labels.
- Memory retrieval scans full scoped history without a record-count cap, chunks oversized records, verifies source IDs against the provided records, and exposes source buttons. Failing any model request rejects the incomplete search. This is model-assisted evidence extraction, not a guarantee against model factual errors.
- Busy/free interval calculation respects recurrence exceptions and overlapping durations. Voice event writes ask before conflicting with existing events in that scope; free-time responses only propose slots.
- Web Push uses owner-RLS subscription rows and service-role-only delivery/test-claim RPCs. Direct default grants to anon/authenticated must be revoked explicitly. `web-push` retains Supabase JWT verification; cron additionally supplies a private scheduler header. Browser tests require a real authenticated JWT. Public VAPID configuration is fetched with the public anon JWT. VAPID private key and scheduler token never enter the client bundle.
- Service worker displays generic lock-screen text and follows same-origin item links. The app opens only IDs present in its accessible cache. The scheduler checks a five-minute due window every minute and atomically leases sends, retries unsent leases after two minutes, and removes 404/410 subscriptions. A network/provider success followed by a database failure can still retry; service-worker tags coalesce duplicate presentation. There is no native-style repeating snooze on web.

Server deployment and verification evidence are recorded in `docs/IMPLEMENTATION-ROADMAP.md`.

## Connected calendars (read-only)

`src/integrations/calendar/` adds Google/Outlook via the `calendar-api` Edge Function and Apple device access via Expo Calendar 57. Sources are explicit opt-in and account-keyed; external events remain ephemeral personal-space views, separate from mutable/synced `items`. `externalCalendar` marks read-only view Items and exclusive interval boundaries. Queries/availability merge them only in personal scope; item writes and notification scheduling do not import them. Refresh failure prevents incomplete free-time answers.

Provider credentials are AES-GCM encrypted server-side. Service-only tables and atomic OAuth state completion are in `20260907100000_calendar_connections.sql`. See [calendar setup and limitations](CALENDAR-INTEGRATION.md) for OAuth provisioning, native rebuild, dedupe guarantees, refresh behavior, and live acceptance steps.
