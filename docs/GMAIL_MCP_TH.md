# เชื่อม Gmail MCP กับ VORA

สถานะ: รองรับการเชื่อม/ยกเลิกบัญชี Google และ initialize + tools/list + tools/call กับ Gmail MCP ทางการผ่าน Supabase ของ **VORA** ด้วยสิทธิ์ `gmail.readonly` รองรับคำสั่งเสียงค้น/อ่านอีเมล โดยยังไม่เปิดการส่งอีเมล รุ่นนี้ไม่รับ URL MCP จากผู้ใช้ และไม่เก็บเนื้อหาอีเมลในฐานข้อมูลโดยอัตโนมัติ

## 1. Google Cloud

Gmail MCP เป็น Developer Preview ต้องได้รับสิทธิ์ [Google Workspace Developer Preview](https://developers.google.com/workspace/preview) ก่อน ไม่ใช่การเปิด Gmail API อย่างเดียว

เปิด `gmail.googleapis.com` และ `gmailmcp.googleapis.com` ใน Google Cloud project ที่ใช้ OAuth client นี้

ใน Google Auth Platform ตั้ง Branding/Audience และเพิ่มบัญชีทดสอบหากยังอยู่ใน Testing จากนั้นเพิ่ม Data Access scope:

```
https://www.googleapis.com/auth/gmail.readonly
```

สร้าง OAuth client ประเภท **Web application** สำหรับ Gmail แยกจาก Calendar (เพื่อแยกสิทธิ์และการเพิกถอน) เพิ่ม Authorized redirect URI:

```
https://<VORA_PROJECT_REF>.supabase.co/functions/v1/gmail-api
```

เก็บ Client ID และ Client Secret ไว้ตั้งที่ Supabase ของ VORA การเปิดใช้สาธารณะต้องตรวจข้อกำหนดการยืนยันแอปสำหรับ Gmail restricted scopes ตาม Google ก่อน

## 2. Supabase ของ VORA

รันจากโฟลเดอร์ `voice-reminder` ด้วยบัญชี Supabase ที่เข้าถึง VORA ได้ ใช้ Personal Access Token ของบัญชี VORA หาก CLI ยังล็อกอินบัญชี Daily Budget

ตรวจและ push migration ที่ค้างอยู่ (คำสั่งนี้ push ทุก migration ที่ยังไม่ applied ไม่ใช่เฉพาะ Gmail):

```sh
supabase link --project-ref <VORA_PROJECT_REF>
supabase db push --dry-run
supabase db push
```

ไฟล์ใหม่ `20260911000000_gmail_mcp.sql` สร้างตาราง credential/state แยกจากปฏิทิน เปิด RLS และให้เข้าถึงเฉพาะ service_role พร้อม RPC consume state แบบ atomic

สร้าง encryption key ครั้งเดียว:

```sh
openssl rand -base64 32
```

ตั้ง secrets โดยแทน placeholder ด้วยค่าของคุณ (อย่านำค่าจริงเข้า git):

```sh
supabase secrets set \
  GOOGLE_GMAIL_CLIENT_ID='<google-client-id>' \
  GOOGLE_GMAIL_CLIENT_SECRET='<google-client-secret>' \
  GMAIL_TOKEN_KEY='<base64-key-32-bytes>' \
  GMAIL_RETURN_URLS='voicereminder://gmail/callback,https://your-vora.vercel.app/' \
  --project-ref <VORA_PROJECT_REF>
```

`GMAIL_RETURN_URLS` ต้องตรงทั้ง URL และ slash ท้าย รวม pathname ถ้าเว็บไม่ได้อยู่ `/` เพิ่ม `http://localhost:8081/` ได้สำหรับพัฒนา ไม่ใช้ wildcard อย่าเปลี่ยน encryption key หลังมีบัญชีเชื่อมแล้วโดยไม่มีแผนย้าย/เชื่อมใหม่

Deploy:

```sh
supabase functions deploy gmail-api --project-ref <VORA_PROJECT_REF>
```

config มี `verify_jwt = false` เฉพาะ endpoint นี้เพื่อรับ OAuth callback; ทุก POST ตรวจ Supabase user ด้วย `auth.getUser` ก่อนเข้าถึงข้อมูล และ OAuth callback ตรวจ state ที่สุ่ม/หมดอายุ/ใช้ได้ครั้งเดียว Tokens เข้ารหัส AES-GCM โดยผูกกับ user และ provider

## 3. ตัวแอป VORA

ไม่ต้องเพิ่ม EXPO_PUBLIC Gmail secret ใช้ `EXPO_PUBLIC_SUPABASE_URL` และการล็อกอิน VORA เดิม Rebuild/redeploy แอปแล้วเข้า Settings → MCP Connections → Gmail

1. ล็อกอิน VORA
2. กดเชื่อมบัญชี Google และอนุญาตอ่าน Gmail
3. กลับเข้า VORA แล้วกดทดสอบ Gmail MCP
4. เมื่อสำเร็จจะเห็นเครื่องมืออ่าน เช่น search_threads / get_thread ตามรายชื่อที่ Google คืนมา

การอนุญาต OAuth สำเร็จไม่ได้ยืนยันว่าได้รับสิทธิ์ MCP Preview ต้องกดทดสอบอีกครั้ง ถ้าไม่ผ่าน ตรวจ Preview, API enablement, scopes และบัญชีทดสอบ

การยกเลิกการเชื่อมใน VORA ลบ credential และ OAuth state ที่รออยู่ หากต้องการถอน grant จาก Google ด้วย ให้เข้า Google Account → Third-party connections รุ่นนี้ไม่สั่งเพิกถอน grant ของบริการอื่นโดยอัตโนมัติ

## การตรวจสอบ

```sh
npx tsc --noEmit
deno check --config supabase/functions/gmail-api/deno.json supabase/functions/gmail-api/index.ts
deno test --allow-env --config supabase/functions/gmail-api/deno.json supabase/functions/gmail-api/mcp_test.ts supabase/functions/gmail-api/auth_test.ts
```

ทดสอบด้วย MCP SDK จริงและจำลอง HTTP/ฐานข้อมูล ยังต้องตรวจ OAuth กับบัญชีทดสอบจริงหลัง deploy รวมถึง migration กับฐานข้อมูลจริง

อ้างอิง: [Gmail MCP ทางการ](https://developers.google.com/workspace/gmail/api/guides/configure-mcp-server), [Expo WebBrowser SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/webbrowser/)

## อัปเดต: ระบบเรียกเครื่องมือกลาง

รองรับการค้นและอ่าน Gmail ด้วยเสียงแล้ว หลัง deploy gmail-api รุ่นล่าสุดและ rebuild VORA เช่น “ค้นอีเมลนัดหมอสัปดาห์นี้” หรือ “หาอีเมลนัดหมอแล้วตั้งเตือนก่อนหนึ่งชั่วโมง” LLM อ่าน schema เครื่องมือจาก Google และเรียกค้น/เปิด thread ตามความจำเป็น ผลลัพธ์ที่เรียกอ่านจะส่งให้ Groq ประมวลผล โดยไม่ส่ง Google token ให้โมเดล แผนเขียนข้อมูลหลังอ่าน MCP ต้องยืนยันก่อนดำเนินการ ยังไม่เปิดเครื่องมือส่งเมล
