# Voice Reminder — agent notes

แอปผู้ช่วยส่วนตัวสั่งงานด้วยเสียงล้วน (พูด → เข้าใจ intent → บันทึก/ค้น → ตอบด้วยเสียง)
โปรเจกต์พี่น้องคือ `../daily-budget` (Expo + Supabase) จะ integrate กันในอนาคต

**อ่านก่อนเริ่มแก้:**
- `README.md` — ภาพรวม วิธีรัน (cloud ใช้ Expo Go ได้ / on-device ต้อง dev build) และ roadmap
- `docs/ARCHITECTURE.md` — สัญญาของ speech layer, schema ของ intent/ข้อมูล, แผน integrate

**Stack:** Expo SDK 54 (RN 0.86), TypeScript strict. ก่อนเขียนโค้ดที่แตะ API ของ Expo
ให้เช็ค docs เวอร์ชันตรง: https://docs.expo.dev/versions/v57.0.0/

**สถานะ:** Phase 0 (speech playground) เสร็จแล้ว — ถัดไปคือ Phase 1 "The Brain"
(Groq LLM แปลง transcript → intent) สร้างไว้ที่ `src/brain/`
