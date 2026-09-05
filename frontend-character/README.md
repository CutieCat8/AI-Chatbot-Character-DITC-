# Frontend — Character UI (แท็บเล็ต)

หน้าจอ Character แมว 5 สถานะ (Idle / Transition / Web / Sleep / Wake) + lip-flap (อ้าปากตาม
amplitude เสียง ไม่ใช่ viseme-accurate — ตาม Scope ที่บอกว่า "ไม่ต้องเป๊ะ") + อารมณ์
แสดงบนแท็บเล็ตที่ติดกับหุ่นยนต์ **ควบคุมด้วยเสียงล้วน ไม่มีการสัมผัสหน้าจอ**

- **Stack:** Vite + React + TypeScript (เปลี่ยนจาก Next.js เดิม — ให้ตรงกับ `frontend-admin` ที่ปรับ
  มาใช้ Vite แล้ว และหน้านี้ไม่ต้องการ SSR/routing ของ Next.js เลย)
- **สถานะ:** โครงหน้าจอ + lip-flap + สลับ 5 สถานะ เสร็จแล้ว (placeholder art วาดเป็น SVG เอง ไม่ใช่
  งานอาร์ตจริง) **ยังไม่ต่อ backend/Gemini Live จริง**
- **ผู้รับผิดชอบหลัก:** Frontend A

## รันทดสอบ

```bash
cd frontend-character
npm install
npm run dev   # http://localhost:5174 (ไม่ชนพอร์ต frontend-admin ที่ใช้ 5173)
```

หน้าเว็บมีแผงทดสอบด้านขวา: ปุ่มสลับ 5 สถานะเอง + อัปโหลดไฟล์เสียงมาทดสอบ lip-flap จริงได้เลย
(ไม่ต้องรอ backend) — อัปโหลดไฟล์เสียงพูดอะไรก็ได้ กด "เล่น" แล้วดูปากแมวขยับตามเสียง

## โครงสร้างไฟล์ (จุดต่อ backend ในอนาคต)

| ไฟล์ | หน้าที่ | ต่อ backend จริงทีหลังยังไง |
|---|---|---|
| `src/hooks/useAmplitude.ts` | อ่าน amplitude จาก `<audio>` element ผ่าน Web Audio API | เปลี่ยนจากไฟล์ทดสอบเป็น audio element ที่เล่นเสียงจาก WS (`/api/voice/ws` ใน `backend/app/routers/voice.py`) แทน — hook เดิมใช้ต่อได้เลยไม่ต้องแก้ |
| `src/components/CatCharacter.tsx` | วาดหน้าแมว placeholder (SVG ล้วน) รับ `state`+`amplitude` เป็น prop | เปลี่ยนเนื้อในเป็น Rive/Lottie จริงได้ ไม่กระทบโค้ดที่เรียกใช้ (prop เดิม) |
| `src/components/ControlPanel.tsx` | ปุ่มทดสอบสลับสถานะ+เล่นไฟล์เสียง | ตัดออกตอนต่อจริง แทนที่ด้วย logic รับ state จาก WS event |
| `src/App.tsx` | ประกอบทุกอย่างเข้าด้วยกัน | จุดที่ต้องเพิ่มการเชื่อม WS จริง |

## ยังไม่ได้ทำ (รอ Sprint ถัดไป)

- ต่อ WS จริงกับ `backend/app/routers/voice.py` (ตอนนี้ backend ฝั่งนี้ยังไม่พร้อมใช้กับหน้าเว็บ
  โดยตรง — ทดสอบ backend เดี่ยว ๆ ผ่าน `voice_pipeline_dev.py` ไปก่อน)
- เปลี่ยน placeholder SVG เป็นงานอาร์ตแมวจริง (Rive/Lottie ตามแผนเดิม)
- Wake-word / mic capture ฝั่ง browser (ตอนนี้ทดสอบด้วยไฟล์เสียงอัดไว้เท่านั้น)
