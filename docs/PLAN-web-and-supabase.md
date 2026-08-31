# Implementation Plan — Web/PWA support + Supabase sync

เอกสารนี้เขียนให้ agent (codex) ทำต่อได้ทันที ทำงานบน branch **`feat/vora-brain`**
(= UI ใหม่ V.O.R.A. + สมอง action-plan เต็ม + upload fix) แตก branch ย่อยตามงาน

> **หลักการที่ห้ามพัง (invariants):**
> - **Local-first เสมอ** — ถ้า Supabase ไม่ถูกตั้งค่า แอปต้องทำงานได้ครบแบบออฟไลน์เหมือนเดิม
> - **ไม่พัง mobile (iOS/Android)** — ทุกการเปลี่ยนต้องคง path เดิมของ native ไว้
> - **speech เป็น layer สลับได้** (`src/speech/`) — เพิ่ม implementation ใหม่ อย่ารื้อ interface
> - UI/ข้อความเป็นภาษาไทย, timezone อ้างอิง `Asia/Bangkok` เสมอ
> - แต่ละงานย่อย: `npx tsc --noEmit` ต้องผ่าน + `npx expo export -p ios` ต้อง build ผ่าน

โปรเจกต์พี่น้อง **`../daily-budget`** มี pattern ครบทั้ง PWA และ Supabase — ใช้เป็นต้นแบบได้เลย
(อ้าง path ด้านล่าง)

---

# PART A — Web / PWA support

## เป้าหมาย
ให้แอปรันบน browser ได้ (และติดตั้งเป็น PWA) โดย **บน web ใช้ Web Speech API ของ browser
ทำ STT+TTS** (Chrome รองรับภาษาไทย) แทนการอัดเสียง+อัปโหลดไป Groq ส่วน "สมอง" (Groq LLM)
ยิง `fetch` ได้ปกติทุก platform

## ทำไมต้องแยก path
โมดูล native ที่ใช้อยู่ **ไม่ทำงานบน web**: `expo-file-system` `uploadAsync` (cloud STT upload),
`expo-audio` recording (จำกัด), `expo-notifications` scheduling, `expo-speech-recognition`
(native). แต่ speech layer เป็น abstraction อยู่แล้ว → เสียบ web provider เพิ่มได้

## Steps

### A1. ติดตั้ง web target
```bash
npx expo install react-native-web react-dom @expo/metro-runtime
```
- `app.json` → `expo.web`: เพิ่ม `"bundler": "metro"`, `"output": "single"`, `"themeColor"`,
  `"backgroundColor"` (ดูของ `../daily-budget/app.json` เป็นต้นแบบ)
- เพิ่ม npm scripts: `"web": "expo start --web"`, `"web:build": "expo export -p web"`
- **ยืนยัน**: `npx expo start --web` เปิดหน้าเว็บได้ (UI VORA เรนเดอร์; ปุ่มไมค์ยังไม่ทำงานก็ได้ในสเต็ปนี้)

### A2. Web speech provider (STT + TTS ผ่าน browser)
สร้าง `src/speech/webStt.ts` ใช้ Web Speech API:
- STT: `window.SpeechRecognition || window.webkitSpeechRecognition`, ตั้ง `lang = config.locale`
  (`th-TH`), `interimResults = true`, `continuous = false`. เก็บ partial/final ผ่าน event
  `onresult`, จบด้วย `onend`. (ทางเลือก: ใช้ `ExpoWebSpeechRecognition` ที่ package
  `expo-speech-recognition` export มาให้แทนก็ได้ — API เดียวกับ Web Speech)
- ตรวจว่ามีไหม: `isWebSttAvailable()` → `typeof window !== 'undefined' && (SpeechRecognition||webkitSpeechRecognition)`
- TTS: `src/speech/tts.ts` (`expo-speech`) รองรับ web อยู่แล้ว (ใช้ `speechSynthesis`) — ไม่ต้องแก้

### A3. เดินสาย web เข้า `useVoiceInput`
ใน `src/speech/useVoiceInput.ts` เพิ่มสาขา `Platform.OS === 'web'`:
- start/stop เรียก web STT (จาก A2) แทน recorder+uploadAsync และ native speech-recognition
- คง contract เดิม: ป้อน `onResult({ text, engine, elapsedMs })` เหมือน native ทุกอย่าง
- **อย่าแก้** logic ของ brain/store/App — แค่ทำให้ transcript ออกมาถูก

### A4. Engine list บน web
`src/speech/engines.ts`: บน web ให้คืน engine เดียว เช่น `{ id:'web', label:'Browser',
hint:'Web Speech API (Chrome รองรับไทย)', available: isWebSttAvailable() }` และซ่อน
cloud/device (หรือแสดงว่า unavailable บน web) — ปรับ `App.tsx` engine toggle ให้ไม่พังถ้ามี
engine เดียว

### A5. Guard native ที่ไม่มีบน web (ต้องไม่ crash)
- `src/notify/setup.ts` + `src/notify/scheduler.ts`: ต้น ๆ ของทุกฟังก์ชันเพิ่ม
  `if (Platform.OS === 'web') return [] / return;` (ตอนนี้มี try/catch อยู่แล้ว แต่ทำ explicit
  ให้ชัด) → บน web = บันทึก item ได้ แต่ไม่ตั้งเตือน (Web Push อยู่ A7 ทำทีหลัง)
- `src/speech/cloudGroq.ts`: ถ้าจะรองรับ cloud STT บน web ด้วย ให้เพิ่มสาขา web ที่ใช้
  `MediaRecorder` → `Blob` → `FormData.append('file', blob, 'speech.webm')` → `fetch` (browser
  FormData รับ Blob ได้; **อย่า**ใช้ `expo-file-system` บน web). ถ้าไม่ทำ ให้ปล่อยให้ web ใช้
  แค่ Web Speech (A2) ก็พอ
- `src/integrations/dailyBudget.ts`: บน web `dailybudget://` เปิดไม่ได้ → guard
  `Platform.OS === 'web'` แล้วพูด/แจ้งว่ายังไม่รองรับบน web (หรือเปิด URL เว็บของ daily-budget ถ้ามี)

### A6. PWA (ติดตั้งลงเครื่องได้ + ออฟไลน์เปิดได้)
มิเรอร์จาก `../daily-budget`:
- คัดลอกแนวทาง `../daily-budget/scripts/inject-pwa.mjs` และ `gen-web-icons.mjs` + โฟลเดอร์
  `public/` (manifest.json, icons, service worker) มาปรับชื่อเป็น Voice Reminder / VORA
- `web:build` = `expo export -p web && node scripts/inject-pwa.mjs`
- ตั้ง manifest: name, short_name, theme_color (`#02070C` ตาม `src/theme.ts`), icons, display
  `standalone`
- **ยืนยัน**: build web แล้วเปิดใน Chrome เห็นปุ่ม "Install app" และเปิดออฟไลน์ได้ (shell)

### A7. (ทีหลัง/optional) Web Notifications
การเตือนบน web ต้องใช้ **Notification API + Service Worker + Web Push** (ไม่เหมือน local
notification ของ native). ทำเป็นสเต็ปแยกทีหลัง; สเต็ปแรกให้ web "บันทึกได้แต่ไม่เตือน" ก่อน

## Acceptance criteria (Part A)
- [ ] `expo start --web` เปิดได้ UI ครบ ไม่มี error console ที่ทำให้จอขาว
- [ ] บน Chrome: แตะไมค์ → พูดภาษาไทย → เห็น transcript → สมองตอบ (พูดกลับด้วย speechSynthesis)
- [ ] สร้าง/ค้น/ถาม (query today+range)/memory recall ทำงานบน web
- [ ] iOS/Android **ยังทำงานเหมือนเดิมทุกอย่าง** (ไม่ regress) — เทสต์ `expo export -p ios` ผ่าน
- [ ] `npx tsc --noEmit` ผ่าน
- [ ] (ถ้าทำ A6) ติดตั้ง PWA + เปิดออฟไลน์ shell ได้

---

# PART B — Supabase sync (cloud, ข้ามเครื่อง)

## เป้าหมาย
sync `items` ขึ้น Supabase เพื่อ backup + ใช้ข้ามเครื่อง โดย**ยังคง local-first** (ออฟไลน์ยังใช้
ได้ ถ้าไม่ล็อกอิน/ไม่ตั้งค่าก็ทำงานแบบ local เดิม)

## ต้นแบบ (มีครบใน daily-budget แล้ว — คัดลอก pattern)
- `../daily-budget/src/lib/supabase.ts` — สร้าง client แบบ optional (คืน `null` ถ้า env ว่าง →
  แอป local-only)
- `../daily-budget/supabase/schema.sql` — โครงตาราง + RLS + trigger
- `../daily-budget/src/store/cloud.ts` — ตรรกะ sync ขึ้น/ลง

## Data model
ตาราง `public.items` ให้ตรงกับ `src/store/types.ts` (`Item`) + คอลัมน์ sync:
```sql
create table if not exists public.items (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  type          text not null check (type in ('reminder','event','todo','note')),
  title         text not null,
  body          text,
  start_at      timestamptz,
  end_at        timestamptz,
  all_day       boolean not null default false,
  recurrence    jsonb,            -- {freq, byday, interval} | null
  people        text[],           -- memory layer
  raw_text      text,             -- verbatim utterance (memory recall)
  done          boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),  -- เพิ่มเพื่อ last-write-wins
  deleted_at    timestamptz                          -- soft delete → propagate ลบข้ามเครื่อง
);
create index if not exists items_user_updated_idx on public.items (user_id, updated_at desc);
alter table public.items enable row level security;
create policy "items owner" on public.items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- trigger set updated_at = now() ทุก update (ดูตัวอย่าง trigger ใน daily-budget schema)
```
> `notificationIds` เป็น **device-local อย่า sync** — แต่ละเครื่อง reschedule เองจาก start_at/recurrence

## Steps

### B1. Client (optional pattern)
คัดลอก `../daily-budget/src/lib/supabase.ts` มาเป็น `src/lib/supabase.ts`:
- อ่าน `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` (มีใน `.env.example` แล้ว)
- `isSupabaseConfigured()` + export `supabase` เป็น `null` เมื่อไม่ตั้งค่า
- ใช้ `AsyncStorage` เป็น auth storage (native) — บน web ใช้ default (localStorage)

### B2. Schema + migration
- สร้างตาราง `items` ตามด้านบน (ใช้ Supabase MCP `apply_migration` หรือ SQL editor)
- เปิด RLS + policy owner-only + trigger `updated_at`

### B3. Auth (ให้เบาที่สุด)
- ทางเลือกแนะนำ: **Supabase anonymous sign-in** (`supabase.auth.signInAnonymously()`) เพื่อให้ได้
  `user_id` โดยไม่ต้องมีหน้า login — เหมาะกับ voice-first. ต่อยอดเป็น email/OAuth ทีหลังได้
- ถ้าต้องการผูกบัญชีจริง คัดลอกหน้า auth จาก daily-budget (`app/auth.tsx`)

### B4. Sync service
สร้าง `src/store/cloud.ts` (มิเรอร์ daily-budget) + ต่อเข้ากับ `src/store/useStore.ts`:
- **Push (local → cloud):** เมื่อ `addItem`/`updateItem`/`removeItem` ทำงาน และ supabase พร้อม+ล็อกอิน
  → `upsert` (หรือ set `deleted_at` สำหรับลบ) แบบ fire-and-forget (ไม่บล็อก UI). ทุกครั้งเซ็ต
  `updated_at = now()` (ฝั่ง client หรือให้ trigger ทำ)
- **Pull (cloud → local):** ตอน app start/foreground (ดู pattern AppState ใน daily-budget) →
  `select * where updated_at > lastSyncedAt` → merge เข้า store
- **Merge/conflict:** last-write-wins ด้วย `updated_at`. record ที่มี `deleted_at` → ลบออกจาก local
  (+ `cancelNotifications`). record ใหม่ที่ดึงมา → **reschedule notification ในเครื่องนี้**
  (`scheduleForItem`) เพราะ notificationIds เป็น device-local
- **Realtime (optional):** `supabase.channel` subscribe ตาราง items เพื่อ live sync หลายเครื่อง
- เก็บ `lastSyncedAt` ใน AsyncStorage

### B5. เดินสายเข้า store โดยไม่พัง local-first
- ถ้า `supabase == null` → ข้าม push/pull ทั้งหมด (แอป = local เดิม)
- store interface (`addItem/updateItem/removeItem/toggleDone`) **คงเดิม** — sync เป็น side-effect
  ข้างใน ไม่เปลี่ยน signature ที่ `App.tsx` เรียก

### B6. (แนะนำ ทำคู่กัน) ย้าย Groq ไปหลัง Edge Function
ตอนนี้ Groq API key ฝังใน bundle (`src/config.ts`, EXPO_PUBLIC). เมื่อมี Supabase แล้ว ควรทำ
Edge Function `groq-proxy` ที่รับ audio/text แล้วเรียก Groq ด้วย key ฝั่ง server (เหมือน
`../daily-budget/supabase/functions/parse-slip`) — แล้วแก้ `cloudGroq.ts` / `planActions.ts` /
`searchMemory.ts` ให้ยิงไป Edge Function แทน. **สำคัญเป็นพิเศษกับ `searchMemory`** เพราะมันส่ง
ไดอารี่ทั้งก้อนออกทุกครั้งที่ถาม — ผ่าน server จะคุมได้ดีกว่า

## Acceptance criteria (Part B)
- [ ] ไม่ตั้ง env Supabase → แอปทำงาน local ครบเหมือนเดิม (ไม่ error)
- [ ] ตั้ง env + ล็อกอิน → สร้าง item บนเครื่อง A แล้วโผล่บนเครื่อง B (หลัง pull/realtime)
- [ ] ลบบนเครื่อง A → หายบนเครื่อง B (soft delete propagate) + ยกเลิก notification
- [ ] เครื่องใหม่ที่ pull items มา → ตั้งเตือน (reschedule) ให้เองถูกต้อง
- [ ] `updated_at` last-write-wins ทำงาน (แก้ล่าสุดชนะ)
- [ ] `npx tsc --noEmit` ผ่าน, mobile ไม่ regress

---

# ลำดับที่แนะนำให้ทำ
1. **Part A (web)** ก่อน — ได้ platform ใหม่ กระทบ core loop ชัด ทดสอบง่าย
2. **Part B (Supabase)** — sync + auth
3. **B6 (Edge Function)** ปิดท้าย — ความปลอดภัย (ซ่อน key, คุม data egress)

# ไฟล์อ้างอิงในโปรเจกต์ (บริบทให้ codex)
- โครง/เหตุผลทั้งหมด: `docs/ARCHITECTURE.md`
- ชุดประโยคทดสอบสมอง: `docs/test-corpus.md` + `node scripts/test-brain.mjs "..."`
- store local ปัจจุบัน: `src/store/useStore.ts` (zustand + AsyncStorage, key `voice-reminder/items`)
- speech layer (จุดเสียบ web): `src/speech/{useVoiceInput,engines,cloudGroq,deviceStt,tts}.ts`
- pattern ต้นแบบ PWA + Supabase: `../daily-budget/`
