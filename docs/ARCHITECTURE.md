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

> **สถานะ: ทำแล้ว** — ดู `src/brain/` (`prompt.ts`, `parseIntent.ts`, `format.ts`)
> และเทสต์จาก terminal ด้วย `node scripts/test-brain.mjs`

หลังได้ transcript ส่งเข้า Groq LLM (`openai/gpt-oss-120b`, ตั้งใน `config.groq.llmModel`)
แบบ **JSON mode** (`response_format: json_object`) คืน object เช่น:

> ⚠️ Groq ปลด/เปลี่ยนชื่อ model บ่อย — ถ้าเจอ 404 `model_not_found` ให้เช็ครุ่นที่ key
> ใช้ได้ด้วย `GET https://api.groq.com/openai/v1/models` แล้วอัปเดต `config.groq.llmModel`
> (เดิมวางไว้เป็น `llama-3.3-70b-versatile` แต่ key ปัจจุบันไม่มี จึงเปลี่ยนเป็น gpt-oss)

```jsonc
// input: "ตั้งปลุกทุกวัน 8 โมง ยกเว้นเสาร์อาทิตย์"
{
  "intent": "create_reminder",
  "title": "ตั้งปลุก",
  "time": "08:00",
  "recurrence": { "freq": "weekly", "byday": ["MO","TU","WE","TH","FR"] },
  "speak_back": "ตั้งปลุกทุกวันจันทร์ถึงศุกร์ 8 โมงเช้าให้แล้วนะครับ"
}
```

**สิ่งที่ต้องใส่ใน system prompt เสมอ:** วันที่/เวลาปัจจุบัน + `timezone: Asia/Bangkok`
เพื่อให้ตีความ "พรุ่งนี้ / เดือนนี้ / 1–2 Sep" เป็นวันจริงได้ถูก

ชุด intent ที่วางไว้: `create_reminder`, `create_event`, `create_note`, `query`,
`add_expense` (อนาคต) แต่ละ intent → handler ใน "intent router" (ยังไม่มีไฟล์ ให้สร้าง
`src/brain/`)

## 4. Phase 2 — Data model + การเตือน

> **สถานะ: ทำแล้ว (แบบ local-first)** — เก็บด้วย zustand + AsyncStorage ใน
> `src/store/useStore.ts` (record = `Item` ใน `src/store/types.ts`), แปลงจาก intent
> ด้วย `src/brain/toItem.ts`, ตั้งเตือนด้วย `expo-notifications` ใน `src/notify/`.
> **Supabase cloud sync ยังไม่ทำ** — ตั้งใจ defer เพื่อให้ใช้งานเครื่องเดียวได้ทันที
> โดยไม่ต้องมี account; schema ของ store ออกแบบให้ map ตรงกับตาราง Supabase ข้างล่างเมื่อ
> พร้อมทำ sync. **การเตือนจริงต้อง dev build** (Expo Go จะ save ได้แต่ไม่ยิงเตือน)

ตัดสินใจใช้ **ตารางเดียว `items`** แยกชนิดด้วยคอลัมน์ `type` (ตามที่เจ้าของแอปเลือก —
ไม่แยกตาราง holidays; วันหยุดก็คือ item ชนิดหนึ่ง) โครงที่เสนอ (สำหรับ Supabase sync):

```sql
create table items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users,
  type        text not null,          -- 'reminder' | 'event' | 'note'
  title       text not null,
  body        text,
  start_at    timestamptz,            -- เวลาเกิด/เริ่ม
  end_at      timestamptz,            -- ช่วง (เช่น 1–2 Sep)
  recurrence  jsonb,                  -- {freq, byday, ...} ว่าง = ครั้งเดียว
  notify_at   timestamptz,           -- รอบเตือนถัดไป
  done        boolean default false,
  created_at  timestamptz default now()
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
