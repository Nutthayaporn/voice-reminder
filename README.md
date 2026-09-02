# 🎙️ VORA

แอปผู้ช่วยส่วนตัวแบบ **สั่งงานด้วยเสียงล้วน** — พูดสิ่งที่อยากจด/เตือน/ถาม แล้วแอปเข้าใจ
บันทึก และ **ตอบกลับด้วยเสียง** เกิดมาแก้ pain point เดียว: *อยากจดแต่ขี้เกียจพิมพ์เพราะมือ
ไม่ว่าง*

> สถานะปัจจุบัน: **Phase 0–4 + Web/PWA เสร็จ** — พูด → เข้าใจ → บันทึก → เตือน → ตอบ
> และต่อ daily-budget แล้ว. สมองเป็น **Action Plan** (1 ประโยคทำได้หลายคำสั่ง) +
> มี type `todo`; บน Chrome/Edge ใช้ Web Speech API และติดตั้งเป็น PWA ได้. UI แยกเป็น
> พูด/รายการ/ตั้งค่า พร้อมแก้ไข, Undo การลบ, ค่าเตือนเริ่มต้น และ shared household

คำสั่งลบด้วยเสียงรองรับทั้งรายการเดียวตามชื่อ/ลำดับ และลบเป็นกลุ่ม เช่น “ลบรายการที่เลยไปแล้ว”
หรือ “ลบรายการที่ทำเสร็จแล้ว”. การลบหลายรายการต้องพูด “ยืนยัน” ก่อนจึงจะลบจริง
รัน regression test ส่วนนี้ได้ด้วย `npm run test:delete`

---

## แนวคิดของแอป (สำหรับคนมาทำต่อ)

ไม่ใช่แค่ reminder — มันคือ **calendar + reminder + note/diary + todo** ที่รวมกันเป็นก้อนเดียว
สั่งด้วยเสียง แล้วให้ **LLM ตีความว่าประโยคที่พูดคือ intent อะไร** ตัวอย่าง use case จริง:

| พูดว่า | intent | ระบบทำอะไร |
| --- | --- | --- |
| "พรุ่งนี้อย่าลืมกินยาตอน 9 โมง" | `create_reminder` (ครั้งเดียว) | ตั้งเตือนพรุ่งนี้ 09:00 |
| "ตั้งปลุกทุกวัน 8 โมง ยกเว้นเสาร์อาทิตย์" | `create_reminder` + `alert_mode=alarm` | นาฬิกาปลุก recurring จ–ศ 08:00 |
| "พรุ่งนี้ 9 โมงแจ้งเตือนให้โทรหาแม่" | `create_reminder` + `alert_mode=notification` | notification ปกติ |
| "ปลุกกินยา 7 โมง เตือนจนกว่าจะทำ" | `create_reminder` + `remind_until_done=true` | ต้องกดทำแล้ว หรือ Snooze 5/10/30 นาที |
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
│   • web    → Web Speech   │  Chrome/Edge · ไม่อัปโหลดไฟล์เสียง
└──────────┬───────────────┘
           │ text (ไทย)
           ▼
┌──────────────────────────┐
│  🧠 The Brain             │  Groq LLM (JSON) → action plan (หลาย action ต่อ 1 ประโยค)
└──────────┬───────────────┘
           │ actions[]
           ▼
   local store (zustand) + notification/native alarm  →  execute ทุก action
           │
           ▼
   🔊 TTS (src/speech/tts.ts) พูดตอบกลับ
```

### ไฟล์สำคัญ

| ไฟล์ | หน้าที่ |
| --- | --- |
| `App.tsx` | navigation พูด/รายการ/ตั้งค่า + ปุ่มไมค์ + แสดงผล + พูดกลับ |
| `src/speech/types.ts` | **สัญญากลาง** ของ speech (engine id, status, ผลลัพธ์) |
| `src/speech/useVoiceInput.ts` | หัวใจ push-to-talk — คุมการอัด/ฟังแล้วส่ง transcript ออกทาง `onResult` |
| `src/speech/cloudGroq.ts` | STT ฝั่ง cloud — อัพโหลดเสียงไป Groq Whisper |
| `src/speech/deviceStt.ts` | STT ในเครื่อง (expo-speech-recognition) + เช็คว่ารันได้ไหม |
| `src/speech/webStt.ts` | STT บน browser ผ่าน Web Speech API + live partial |
| `src/speech/tts.ts` | พูดตอบกลับด้วยเสียง OS (expo-speech) |
| `src/speech/engines.ts` | รายการ engine + คำนวณว่าตัวไหนใช้ได้ตอนนี้ |
| `src/brain/prompt.ts` | สร้าง prompt ให้ LLM (แนบวันที่/timezone ปัจจุบันเสมอ) |
| `src/brain/planActions.ts` | เรียก Groq LLM (JSON mode) → คืน **action plan** ที่ normalise แล้ว |
| `src/brain/format.ts` | แปลง action เป็นข้อความไทยสวย ๆ สำหรับแสดงผล |
| `src/brain/toItem.ts` | แปลง action (create_*) → `Item` ที่บันทึกได้ (เก็บ raw_text + people) |
| `src/brain/searchMemory.ts` | ค้นความทรงจำย้อนหลัง (LLM-as-retriever) "ลูกเริ่มพูดเมื่อไหร่" |
| `src/store/useStore.ts` | store local-first (zustand + AsyncStorage) เก็บ `items` |
| `src/store/cloud.ts` | map/push/pull/realtime items กับ Supabase (ไม่ sync notification IDs) |
| `src/lib/supabase.ts` | optional Supabase client; env ว่างแล้วคืน local-only mode |
| `src/store/query.ts` | ตอบคำถาม "วันนี้มีอะไร" จาก items ในเครื่อง |
| `src/notify/scheduler.ts` | route ตาม alert_mode แล้วแปลง recurrence → trigger |
| `src/notify/setup.ts` | ตั้ง handler/permission/channel ของ notification |
| `src/notify/nativeAlarm.ts` | bridge กลางสำหรับนาฬิกาปลุกจริง + fallback |
| `modules/voice-alarm/` | Expo local module: AlarmKit (iOS 26+) / AlarmManager (Android) |
| `src/integrations/dailyBudget.ts` | ยิง deep link `dailybudget://entry?...` ส่งรายจ่ายไปแอปงบ |
| `scripts/test-brain.mjs` | เทสต์สมองจาก terminal: `node scripts/test-brain.mjs "…"` |
| `src/config.ts` | ค่าตั้ง + อ่าน API key จาก env (รวมชื่อ Groq model) |
| `src/theme.ts` | สี/spacing รวมศูนย์ (ธีมมืด) |
| `scripts/inject-pwa.mjs` | ผูก manifest/service worker และ precache app shell หลัง web export |

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

โหมด reminder แบบ `alarm` ต้องใช้ dev build เช่นกัน: Android ใช้ exact alarm พร้อมหน้าจอ
ทำแล้ว/Stop/Snooze และ iOS 26+ ใช้ AlarmKit พร้อม Repeat. ในรายการ reminder กดปุ่มรูปแบบ
วนได้ `NOTIFY → ALARM → UNTIL DONE` และกดค่า Snooze เพื่อวน 5/10/30 นาที (ค่าเริ่มต้น
10 นาที รวมสูงสุด 5 รอบ). iOS รุ่นเก่าหรือเครื่องที่ native alarm ไม่พร้อมจะ fallback เป็น
Time Sensitive notification หลายรอบสำหรับรายการแบบ Until Done โดยไม่ทำให้รายการหาย.
Android 12/12L อาจขอสิทธิ์
“Alarms & reminders”; Android 13+ ใช้ `USE_EXACT_ALARM` เพราะการเตือนตามเวลาคือ core function
ของแอป (ตอนขึ้น Play Store ต้องระบุ use case ให้ตรงนโยบาย)

### รันบนเว็บ / สร้าง PWA

```bash
npm run web          # dev server
npm run web:build    # export ไป dist/ + ผูก manifest/service worker
```

เปิดด้วย Chrome หรือ Edge เพื่อใช้ Browser STT ภาษาไทย. PWA เปิด app shell
ออฟไลน์ได้ และ items ยังเก็บแบบ local-first; การตั้งเตือนบน web ยังไม่รองรับ
ในรอบนี้ (ต้องทำ Web Push แยก)

### เปิด Cloud Sync ข้ามเครื่อง (ไม่บังคับ)

1. Apply [`supabase/migrations/20260831000000_items_sync.sql`](supabase/migrations/20260831000000_items_sync.sql)
   ใน Supabase SQL editor
2. เปิด Email/Password provider และตั้ง Google/Facebook provider ตาม
   [`supabase/README.md`](supabase/README.md)
3. เพิ่ม `voicereminder://auth/callback` และ URL ของเว็บใน Supabase Redirect URLs
4. ใส่ `EXPO_PUBLIC_SUPABASE_URL` และ `EXPO_PUBLIC_SUPABASE_ANON_KEY` ใน `.env`

จากนั้นไปที่ Settings → Account & Sync เพื่อสมัครหรือเข้าสู่ระบบด้วย email/password, Google
หรือ Facebook. ถ้าไม่ตั้ง Supabase หรือยังไม่ sign in แอปยังทำงานและเก็บข้อมูลในเครื่อง
เหมือนเดิมทุกอย่าง

ถ้าต้องการใช้ร่วมกับแฟน ให้ apply migration `20260831030000_shared_households.sql` แล้วเข้า
Settings → พื้นที่ร่วมกัน: คนแรกสร้างพื้นที่และส่งรหัสเชิญ 8 ตัวให้อีกคนเข้าร่วม จากนั้นเลือก
พื้นที่นั้นเป็นปลายทางของรายการใหม่ รายการจะซิงก์และแก้ไขร่วมกันได้ทั้งสองบัญชี

---

## Roadmap

| Phase | ได้อะไร | สถานะ |
| --- | --- | --- |
| **0. Speech playground** | ปุ่มเดียว พูด→ถอดเสียง→พูดกลับ + สลับ cloud/device เทียบกัน | ✅ ทำแล้ว |
| **1. The Brain** | ต่อ Groq LLM (JSON mode) แปลง text → intent JSON + พูดตอบกลับ (`src/brain/`) | ✅ ทำแล้ว |
| **2. บันทึก + เตือน** | เก็บ local + เลือก notification หรือนาฬิกาปลุกจริงต่อ reminder (รวม recurring) | ✅ ทำแล้ว |
| **3. Query** | ถาม "วันนี้มีอะไรทำบ้าง" แล้วค้น+สรุปตอบด้วยเสียง | ✅ ทำแล้ว (พื้นฐาน) |
| **4. Integrate budget** | intent `add_expense` → deep link เปิดหน้าเพิ่มรายการของ daily-budget แบบกรอกให้พร้อม | ✅ ทำแล้ว |
| **5. Web / PWA** | Browser STT, web guards, installable/offline app shell | ✅ ทำแล้ว |
| **6. Supabase sync** | email/password + Google/Facebook + offline queue + LWW/soft delete + Realtime | ✅ โค้ดพร้อม (ต้องตั้ง provider + apply migration) |

รายละเอียดเชิงลึก (สัญญาของ speech layer, schema ของ intent/ข้อมูล, แผน integrate) อยู่ที่
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

---

## ⚠️ หมายเหตุด้านความปลอดภัย

`EXPO_PUBLIC_GROQ_API_KEY` จะถูก **ฝังลงใน bundle ของแอป** (นี่คือวิธีที่ Expo inline env)
โอเคสำหรับใช้ส่วนตัว/ตอน dev แต่ **ก่อน release** ต้องย้ายการเรียก Groq ไปหลัง
Supabase Edge Function (แพตเทิร์นเดียวกับที่ daily-budget ใช้กับ slip OCR) เพื่อไม่ให้ key หลุด

## Stack

Expo SDK 57 (React Native 0.86) · TypeScript · React Native Web · expo-audio · expo-speech ·
expo-speech-recognition · Groq Whisper — ล้อแนวเดียวกับโปรเจกต์พี่น้อง `daily-budget`
เพื่อให้ integrate กันง่ายในอนาคต
