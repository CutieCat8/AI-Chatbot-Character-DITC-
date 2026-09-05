# Frontend — Character UI (แท็บเล็ต)

หน้าจอ Character แมว 5 สถานะ (Idle / Transition / Web / Sleep / Wake) + lip-flap (อ้าปากตาม
amplitude เสียง ไม่ใช่ viseme-accurate — ตาม Scope ที่บอกว่า "ไม่ต้องเป๊ะ") + อารมณ์
แสดงบนแท็บเล็ตที่ติดกับหุ่นยนต์ **ควบคุมด้วยเสียงล้วน ไม่มีการสัมผัสหน้าจอ**

- **Stack:** Vite + React + TypeScript (เปลี่ยนจาก Next.js เดิม — ให้ตรงกับ `frontend-admin` ที่ปรับ
  มาใช้ Vite แล้ว และหน้านี้ไม่ต้องการ SSR/routing ของ Next.js เลย)
- **สถานะ:** ต่อ Gemini Live จริงผ่านเบราว์เซอร์แล้ว (ไมค์จริง -> WS -> เสียงตอบจริง -> lip-flap จริง)
  placeholder art ยังเป็น SVG เอง ไม่ใช่งานอาร์ตจริง
- **ผู้รับผิดชอบหลัก:** Frontend A

## รันทดสอบ

ต้องรัน backend ก่อน (`docker compose up` ที่ root ของ repo — ต้องมี `GEMINI_API_KEY` ใน `.env`)

```bash
cd frontend-character
npm install
npm run dev   # http://localhost:5174 (ไม่ชนพอร์ต frontend-admin ที่ใช้ 5173)
```

หน้าเว็บมี 2 โหมด (แท็บด้านบน):

- **คุยด้วยเสียงจริง** — กด "เริ่มคุย" (เบราว์เซอร์ขอสิทธิ์ไมค์ครั้งแรก) แล้วพูดได้เลย ไม่ต้องกดปุ่มอื่น
  อีก แมวจะฟัง+ตอบ+ขยับปากตามเสียงจริงจาก Gemini Live ครบวงในหน้านี้
- **ทดสอบด้วยไฟล์เสียง** — อัปโหลดไฟล์เสียงมาทดสอบ lip-flap แยกได้โดยไม่ต้องพึ่ง backend/ไมค์เลย
  (มีประโยชน์เวลาจะ debug แค่ส่วนแอนิเมชันเฉย ๆ)

## Half-duplex (ตั้งใจ ไม่ใช่บั๊ก)

เหมือนกับ `voice_pipeline_dev.py` — ไมค์จะหยุดส่งเสียงเข้า backend ระหว่างที่แมวกำลังพูด (เช็คจาก
เวลาที่ audio ที่ schedule ไว้ยังเล่นไม่จบ) แล้วกลับมาฟังใหม่ทันทีที่พูดจบ เหตุผลเดียวกัน: เครื่อง dev
ทั่วไปไม่มี AEC ฮาร์ดแวร์ เสียงจากลำโพงจะหลุดกลับเข้าไมค์แล้วสับสนกับเสียงพูดจริงได้ ดูรายละเอียดเต็ม
ในคอมเมนต์บนสุดของ `backend/app/scripts/voice_pipeline_dev.py`

## โครงสร้างไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `src/hooks/useVoiceSocket.ts` | **ตัวจริง** — ไมค์ (getUserMedia + downsample เป็น 16kHz) -> WS (`/api/voice/ws`) -> เล่นเสียงตอบ (จัดคิว + jitter buffer 1.5s เหมือน `voice_test.html`) -> amplitude วัดจาก AnalyserNode ที่ต่ออยู่ในเส้นทางเล่นเสียงจริง (ไม่ใช่วัดตอนรับข้อมูลดิบ ซึ่งจะเพี้ยนไปหน้า jitter buffer) |
| `src/hooks/useAmplitude.ts` | อ่าน amplitude จาก `<audio>` element — ใช้เฉพาะโหมดทดสอบไฟล์เสียง |
| `src/components/CatCharacter.tsx` | วาดหน้าแมว placeholder (SVG ล้วน) รับ `state`+`amplitude` เป็น prop เดียวกันไม่ว่าจะมาจากโหมดไหน — เปลี่ยนเป็น Rive/Lottie จริงทีหลังได้โดยไม่กระทบโค้ดที่เรียกใช้ |
| `src/components/LiveVoicePanel.tsx` | ปุ่มเริ่ม/หยุดคุยจริง + แสดงสถานะ WS + transcript |
| `src/components/ControlPanel.tsx` | โหมดทดสอบไฟล์เสียง (ปุ่มสลับสถานะเอง + อัปโหลดไฟล์) |
| `src/App.tsx` | สลับ 2 โหมด + ส่ง state/amplitude ที่ถูกต้องให้ `CatCharacter` |

## ข้อจำกัดที่ทดสอบเองไม่ได้ (ต้องให้คนจริงทดสอบ)

สิทธิ์ไมค์ (`getUserMedia`) เป็น native browser permission prompt — เครื่องมือ automation ทั่วไป
คลิกอนุมัติเองไม่ได้ (ไม่ใช่ DOM element) และ chrome://settings ก็ตั้งล่วงหน้าผ่าน automation ไม่ได้
เช่นกัน (ถูกบล็อกไว้โดยตั้งใจ) — ทดสอบได้แค่ถึงจุดที่กดปุ่ม "เริ่มคุย" แล้ว browser เด้งขอสิทธิ์ถูกต้อง
ไม่มี error ใน console หลังจากนั้น (พูดจริงแล้วแมวขยับปากตอบ) **ต้องให้คนจริงกดอนุญาตแล้วพูดทดสอบเอง**

## ยังไม่ได้ทำ

- เปลี่ยน placeholder SVG เป็นงานอาร์ตแมวจริง (Rive/Lottie ตามแผนเดิม)
- Wake-word (ตอนนี้ต้องกดปุ่ม "เริ่มคุย" ครั้งแรกเสมอ — ข้อจำกัดของเบราว์เซอร์ที่ต้องมี user gesture
  ก่อนถึงจะขอสิทธิ์ไมค์/เล่นเสียงได้ ตัดออกไม่ได้ แต่หลังกดครั้งแรกแล้วไม่ต้องกดอะไรอีกเลย)
- Cat state ตอนนี้เดาจากสัญญาณที่มี (มี/ไม่มีเสียงเล่น, local RMS ของไมค์) ยังไม่ได้รับ event บอก
  state ตรง ๆ จาก backend (เช่น "กำลังเรียก tool" จริง ๆ) — ถ้าอยากให้แม่นขึ้นต้องเพิ่ม message type
  ใหม่ใน `routers/voice.py` ส่งบอกตอน tool_call เริ่ม/จบ
