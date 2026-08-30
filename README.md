# 🎙️ Voice Reminder

แอปผู้ช่วยส่วนตัวแบบ **สั่งงานด้วยเสียงล้วน** — พูดสิ่งที่อยากจด/เตือน/ถาม แล้วแอปเข้าใจ
บันทึก และ **ตอบกลับด้วยเสียง** เกิดมาแก้ pain point เดียว: *อยากจดแต่ขี้เกียจพิมพ์เพราะมือ
ไม่ว่าง*

> สถานะปัจจุบัน: **Phase 0 — Speech playground** (พิสูจน์ลูป พูด → ถอดเสียง → ตอบกลับ
> พร้อมสวิตช์เทียบ engine cloud/on-device) ยังไม่มีการบันทึกหรือ "สมอง" ที่เข้าใจ intent
> ดู roadmap ด้านล่าง

---

## แนวคิดของแอป (สำหรับคนมาทำต่อ)

ไม่ใช่แค่ reminder — มันคือ **calendar + reminder + note/diary + todo** ที่รวมกันเป็นก้อนเดียว
สั่งด้วยเสียง แล้วให้ **LLM ตีความว่าประโยคที่พูดคือ intent อะไร** ตัวอย่าง use case จริง:

| พูดว่า | intent | ระบบทำอะไร |
| --- | --- | --- |
| "พรุ่งนี้อย่าลืมกินยาตอน 9 โมง" | `create_reminder` (ครั้งเดียว) | ตั้งเตือนพรุ่งนี้ 09:00 |
| "ตั้งปลุกทุกวัน 8 โมง ยกเว้นเสาร์อาทิตย์" | `create_reminder` (ซ้ำ + เงื่อนไข) | recurring จ–ศ 08:00 |
| "1–2 Sep พ่อแม่ไปขายของ" | `create_event` | บันทึกช่วงวันที่ |
| "วันนี้เป็นวันแรกที่ลูกพูดได้" | `create_note` (diary) | บันทึกความทรงจำผูกวันที่ |
| "วันนี้มีอะไรต้องทำบ้าง" | `query` | ค้น แล้วสรุปตอบด้วยเสียง |
| "ซื้อโจ๊กไป 60 บาท" | `add_expense` *(อนาคต)* | ยิง API ไปแอป **daily-budget** |

**หัวใจที่ยากไม่ใช่เสียง** — เสียงเป็นแค่ input/output. หัวใจคือ "สมอง" ที่แปลงภาษาพูด
กำกวมภาษาไทย (โดยเฉพาะเวลา: "พรุ่งนี้", "ทุกวันยกเว้นเสาร์อาทิตย์") ให้เป็น structured data
ที่ถูกต้อง โดยส่ง "วันนี้คือวันที่เท่าไร + timezone Asia/Bangkok" เข้า prompt เสมอ

---

## สถาปัตยกรรม

```
🎙️ แตะปุ่ม → อัดเสียง / ฟัง
        │
        ▼
┌──────────────────────────┐   สลับได้ที่ UI (src/speech/engines.ts)
│  STT engine (สลับได้)     │
│   • cloud  → Groq Whisper │  แม่นไทยสูง ต้องต่อเน็ต + API key (ทำงานใน Expo Go ได้)
│   • device → OS on-device │  ฟรี เร็ว ออฟไลน์ได้ (ต้อง dev build)
└──────────┬───────────────┘
           │ text (ไทย)
           ▼
┌──────────────────────────┐
│  🧠 The Brain (Phase 1)   │  LLM function-calling → intent + payload (ยังไม่ทำ)
└──────────┬───────────────┘
           │ intent
           ▼
   Supabase + expo-notifications (Phase 2)  →  สรุปผล
           │
           ▼
   🔊 TTS (src/speech/tts.ts) พูดตอบกลับ
```

### ไฟล์สำคัญ

| ไฟล์ | หน้าที่ |
| --- | --- |
| `App.tsx` | หน้าจอเดียว: ปุ่มไมค์ + สวิตช์ engine + แสดงผล + พูดกลับ |
| `src/speech/types.ts` | **สัญญากลาง** ของ speech (engine id, status, ผลลัพธ์) |
| `src/speech/useVoiceInput.ts` | หัวใจ push-to-talk — คุมการอัด/ฟังแล้วส่ง transcript ออกทาง `onResult` |
| `src/speech/cloudGroq.ts` | STT ฝั่ง cloud — อัพโหลดเสียงไป Groq Whisper |
| `src/speech/deviceStt.ts` | STT ในเครื่อง (expo-speech-recognition) + เช็คว่ารันได้ไหม |
| `src/speech/tts.ts` | พูดตอบกลับด้วยเสียง OS (expo-speech) |
| `src/speech/engines.ts` | รายการ engine + คำนวณว่าตัวไหนใช้ได้ตอนนี้ |
| `src/brain/prompt.ts` | สร้าง prompt ให้ LLM (แนบวันที่/timezone ปัจจุบันเสมอ) |
| `src/brain/parseIntent.ts` | เรียก Groq LLM (JSON mode) → คืน intent ที่ normalise แล้ว |
| `src/brain/format.ts` | แปลง intent เป็นข้อความไทยสวย ๆ สำหรับแสดงผล |
| `src/brain/toItem.ts` | แปลง intent (create_*) → `Item` ที่บันทึกได้ |
| `src/store/useStore.ts` | store local-first (zustand + AsyncStorage) เก็บ `items` |
| `src/store/query.ts` | ตอบคำถาม "วันนี้มีอะไร" จาก items ในเครื่อง |
| `src/notify/scheduler.ts` | แปลง item.recurrence → local notification triggers |
| `src/notify/setup.ts` | ตั้ง handler/permission/channel ของ notification |
| `src/integrations/dailyBudget.ts` | ยิง deep link `dailybudget://entry?...` ส่งรายจ่ายไปแอปงบ |
| `scripts/test-brain.mjs` | เทสต์สมองจาก terminal: `node scripts/test-brain.mjs "…"` |
| `src/config.ts` | ค่าตั้ง + อ่าน API key จาก env (รวมชื่อ Groq model) |
| `src/theme.ts` | สี/spacing รวมศูนย์ (ธีมมืด) |

**การเพิ่ม/สลับ engine ทำที่จุดเดียว:** implement STT ตัวใหม่ แล้วผูกเข้ากับ
`useVoiceInput` + เพิ่ม entry ใน `engines.ts` — `App.tsx` ไม่ต้องแก้ตรรกะ

---

## การติดตั้งและรัน

```bash
npm install
cp .env.example .env      # ใส่ EXPO_PUBLIC_GROQ_API_KEY (ฟรีจาก console.groq.com/keys)
```

### รันแบบ cloud engine (ง่ายสุด — ใช้ Expo Go ได้)
```bash
npx expo start
```
สแกน QR ด้วยแอป **Expo Go** บนมือถือ → เลือก engine **Cloud** → แตะไมค์แล้วพูด
(ฝั่ง cloud ใช้แค่การอัดเสียง + เรียก API จึงทำงานใน Expo Go ได้เลย)

### รันแบบ on-device engine (ต้อง dev build)
`expo-speech-recognition` เป็น native module ที่ **ไม่มีใน Expo Go** ต้อง build เอง:
```bash
npx expo run:ios      # หรือ  npx expo run:android
```
แล้วในแอปจะเลือก engine **On-device** ได้ (ถ้ายังรันใน Expo Go ปุ่มนี้จะถูก disable
พร้อมบอกเหตุผล)

---

## Roadmap

| Phase | ได้อะไร | สถานะ |
| --- | --- | --- |
| **0. Speech playground** | ปุ่มเดียว พูด→ถอดเสียง→พูดกลับ + สลับ cloud/device เทียบกัน | ✅ ทำแล้ว |
| **1. The Brain** | ต่อ Groq LLM (JSON mode) แปลง text → intent JSON + พูดตอบกลับ (`src/brain/`) | ✅ ทำแล้ว |
| **2. บันทึก + เตือน** | เก็บ local (zustand+AsyncStorage) + `expo-notifications` ยิงเตือน (รวม recurring) | ✅ ทำแล้ว |
| **3. Query** | ถาม "วันนี้มีอะไรทำบ้าง" แล้วค้น+สรุปตอบด้วยเสียง | ✅ ทำแล้ว (พื้นฐาน) |
| **4. Integrate budget** | intent `add_expense` → deep link เปิดหน้าเพิ่มรายการของ daily-budget แบบกรอกให้พร้อม | ✅ ทำแล้ว |

รายละเอียดเชิงลึก (สัญญาของ speech layer, schema ของ intent/ข้อมูล, แผน integrate) อยู่ที่
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

---

## ⚠️ หมายเหตุด้านความปลอดภัย

`EXPO_PUBLIC_GROQ_API_KEY` จะถูก **ฝังลงใน bundle ของแอป** (นี่คือวิธีที่ Expo inline env)
โอเคสำหรับใช้ส่วนตัว/ตอน dev แต่ **ก่อน release** ต้องย้ายการเรียก Groq ไปหลัง
Supabase Edge Function (แพตเทิร์นเดียวกับที่ daily-budget ใช้กับ slip OCR) เพื่อไม่ให้ key หลุด

## Stack

Expo SDK 54 (React Native 0.86) · TypeScript · expo-audio · expo-speech ·
expo-speech-recognition · Groq Whisper — ล้อแนวเดียวกับโปรเจกต์พี่น้อง `daily-budget`
เพื่อให้ integrate กันง่ายในอนาคต
