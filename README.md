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
🎙️ Hands-free (หรือแตะปุ่ม) → อัดเสียง / ฟัง
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
| `src/speech/useVoiceInput.ts` | คุมการอัด/ฟัง, auto-stop หลังเงียบ 2–3 วินาที แล้วส่ง transcript ทาง `onResult` |
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

เมื่อเปิดแอปใหม่ VORA จะขอสิทธิ์ไมค์ (ถ้ายังไม่ได้อนุญาต), ทักสั้น ๆ หนึ่งครั้ง แล้วเปิดไมค์
ให้พูดได้ทันที. ระหว่าง app session เดียวกัน หากสลับแท็บหรือกลับเข้า **Talk** จะเปิดไมค์ให้พูด
ได้เลยโดยไม่ทักซ้ำ; เมื่อปิดแล้วเปิดแอปใหม่จึงทักใหม่. เมื่อเงียบประมาณ 1.2 วินาทีระบบจะถือว่าพูดจบ;
เมื่อ Hands-free เป็น OFF หลัง AI ตอบจะไม่เปิดไมค์ซ้ำ หากต้องการสั่งต่อให้แตะ **Tap to Talk**. นี่เป็น one-shot
ของหน้า Talk และไม่เกี่ยวกับ config Hands-free. **Hands-free** เป็น config แยก
(ค่าเริ่มต้น OFF) สำหรับเปิดไมค์ต่อหลัง AI ตอบ; เปิดปิดได้จากปุ่มใต้ไมค์หรือ Settings.
ตั้ง **Stop after silence** เป็น OFF ได้หากต้องการให้ทั้ง Tap-to-talk และ Hands-free ฟังต่อ
จนกว่าจะแตะ Stop เอง (ค่าเริ่มต้นเป็น ON).

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
ออฟไลน์ได้ และ items ยังเก็บแบบ local-first; เปิด Web Push ใน Settings หลังเข้าสู่ระบบ
เพื่อรับการแจ้งเตือนจากรายการที่ซิงค์แล้ว แม้ปิดหน้าเว็บ (HTTPS/เบราว์เซอร์ที่รองรับ)

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

ถ้าต้องการใช้ร่วมกับแฟน ให้ apply migrations `20260831030000_shared_households.sql` และ
`20260906000000_household_invite_links.sql` แล้วเข้า Settings → Sharing: คนแรกสร้างพื้นที่
แล้วกดปุ่ม Share ข้างชื่อพื้นที่เพื่อส่ง invite link ผ่าน LINE/Messages. ผู้รับแตะลิงก์ ล็อกอิน
(ถ้ายังไม่ได้ล็อกอิน) ตรวจชื่อพื้นที่ แล้วกด Join ครั้งเดียว; รหัสเชิญ 8 ตัวยังใช้กรอกเองเป็น
fallback ได้ จากนั้นเลือกพื้นที่นั้นเป็นปลายทางของรายการใหม่ รายการจะซิงก์และแก้ไขร่วมกันได้
ทั้งสองบัญชี

ระหว่างพัฒนา native build จะ share `voicereminder://` (Expo Go ใช้ development URL) ส่วนเว็บ
จะ share origin ปัจจุบัน เมื่อมี public PWA domain ให้ตั้ง `EXPO_PUBLIC_INVITE_BASE_URL` เพื่อให้
ทุกแพลตฟอร์มส่ง HTTPS invite URL เดียวกัน

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


## Personal / Spaces, discovery and structured memory (2026-09-07)

The Space selector above Talk, Items and Calendar controls the default capture and query scope. Say a real Space name (or your own alias), or explicitly say “จดส่วนตัวว่า…”. Names are resolved to accessible IDs; ambiguous or unavailable names do not silently select a destination. `share_item` moves an existing personal item into a named shared Space. Destructive bulk commands remain confirmed and scoped.

Open **VORA ทำอะไรได้บ้าง** on Talk or ask by voice for the same capability catalog. The guide reflects web notification limitations and Daily Budget connection state. Example buttons speak examples without creating records.

**Settings → Memory** manages people, pets and places. Canonical profiles live in their selected personal/Space scope. Your relationship aliases (for example “แม่”) remain account-specific on this device. Voice example: “โมจิคือแมวของเรา จดส่วนตัว”. Linked profile IDs must belong to the same Space as the item.

New event/task reminders use a parent link: moving, completing or deleting the parent updates its linked reminders. “สรุปวันนี้ให้หน่อย” includes overdue tasks. Shopping commands such as “เพิ่มไข่สองแผงในลิสต์ซื้อของ” track quantity/unit and merge duplicates only within the same list and Space.

Cloud deployments need `supabase/migrations/20260907000000_item_details.sql` (applied to the linked project during implementation). Existing clients preserve structured details when editing an item. The rollout and remaining work are tracked in [docs/IMPLEMENTATION-ROADMAP.md](docs/IMPLEMENTATION-ROADMAP.md).

Validation: `npm run test:spaces`, `npm run test:knowledge`, `npm run test:planning`, plus existing delete/speech tests. Optional live prompt checks: `node --experimental-strip-types scripts/test-feature-brain.mts` (uses Groq quota and only synthetic fixtures).


### Assignment, recurrence, preferences and recall

Open an item's editor to choose its assignee and notification recipients. These settings do not change who can see the Space. Complete/skip/reopen one recurring occurrence by voice; today's controls and occurrence history are in the editor. Calendar completion applies to the selected date.

Settings includes explicit time phrases (e.g. “ตอนเช้า = 07:30”), reminder lead minutes, and Thai/English/match-input responses. Preferences are account-keyed on the current device. Explicit times and “no reminder” override defaults. Full-history recall scans every accessible record in batches, returns source buttons, and fails visibly if a batch cannot be searched. Long histories use more model calls and may hit quota limits.

Ask for a free interval within a window of up to 31 days. Voice event creation/moves check existing events in the selected Space and ask before an overlap, with a next-slot proposal. They do not inspect other private calendars or external calendars.

### Web Push

Settings → Web Push → enable → send test. On iPhone, install the PWA on the Home Screen first. This requires sign-in and synced items. Notification text is generic; tapping opens the original item. Explicit recipients are honored; personal items only go to their owner. Sign-out unsubscribes this browser before ending the session.

The linked Supabase project now has `web-push` with platform JWT verification enabled, server-only VAPID secrets, Vault-backed scheduler credentials, and a minute cron. Delivery claims prevent concurrent duplicates, failed sends retry within the five-minute due window, and expired subscriptions are removed. Push delivery is best effort; it does not implement native alarm/snooze/until-done behavior. First-time setup for a new project: apply migrations, deploy `web-push`, then run `node --env-file=.env scripts/setup-web-push.mjs` after authorizing server setup. Never rerun initial setup to rotate existing VAPID keys.

Native recurring notifications with exceptions or intervals greater than one use a rolling queue of up to eight upcoming occurrences (within ten years), refreshed when the app opens/resumes. Reopen the app periodically to replenish them; OS pending-notification limits still apply. Verify alarms on an actual device.

Checks: `npx tsc --noEmit`, `npm run test:remaining`, existing regression scripts, and `npm run web:build`. `scripts/test-push-db.sql` validates claims and RLS in a rolled-back transaction. Live Groq checks use synthetic data and stop on HTTP 429. End-device push delivery still needs enabling a real browser subscription and pressing Send test.

### เชื่อม Google / Outlook / Apple Calendar

Settings → Calendars ให้เชื่อมบัญชีและเลือกปฏิทินที่จะอ่าน รายการแสดงรวมใน Calendar ของพื้นที่ส่วนตัว และใช้ตอบคำถามตาราง/หาเวลาว่างด้วยเสียงได้ นัดภายนอกเป็น read-only ไม่สร้างการแจ้งเตือนซ้ำใน VORA

Google/Outlook ต้องตั้ง OAuth app, Supabase secrets และ deploy Edge Function ก่อน; Apple ต้อง rebuild แอป iOS พร้อม Expo Calendar ดู [วิธีตั้งค่าและข้อจำกัด](docs/CALENDAR-INTEGRATION.md) และทดสอบด้วย `npm run test:calendar`.
