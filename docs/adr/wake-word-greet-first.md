# ADR: แมวทักทายก่อนเอง (greet-first) เฉพาะทาง wake-word — ขัดหลักการเดิม

- **สถานะ:** ตัดสินใจแล้ว ยังไม่ได้ทดสอบกับ Gemini Live จริง (2026-09-11)
- **บริบท:** `docs/superpowers/specs/2026-09-08-wake-word-design.md` เขียนไว้ตั้งแต่แรกว่า wake-word
  ต้องเรียก `voice.connect()` เดียวกับปุ่ม "เริ่มคุย" ทุกประการ **ไม่มี code path แยก กันพฤติกรรมสอง
  ทางไม่ตรงกัน** — ผู้ใช้ทดสอบ wake-word จริงแล้วพบว่าตื่นมาแล้วต้องพูดก่อนแมวถึงจะตอบ (นั่งรอเงียบๆ
  เหมือนปุ่ม "เริ่มคุย") แล้วขอเพิ่มให้แมวทักทายก่อนเอง **แต่เฉพาะทาง wake-word เท่านั้น** ไม่ใช่ปุ่ม —
  ยืนยันชัดเจนจากผู้ใช้โดยตรงว่าต้องการแยกพฤติกรรม แม้จะขัดกับหลักการเดิมที่เขียนไว้

## ทำไมถึงยอมขัดหลักการเดิม

เหตุผลของผู้ใช้ (ตามที่ระบุระหว่างคุย): ปุ่ม "เริ่มคุย" ผู้ใช้กดเองอยู่แล้ว เป็นการยืนยันความตั้งใจว่า
พร้อมพูดแล้ว แต่ wake-word ไม่มีปุ่มให้กดยืนยันอีกทีหลังตื่น — นั่งรอเงียบๆ ทำให้ผู้ใช้ไม่รู้ว่าระบบพร้อม
ฟังหรือยัง (ต่างจากกดปุ่มที่เห็น UI เปลี่ยนทันที) การให้แมวทักทายก่อนคือการยืนยันกลับแทนปุ่มที่ไม่มี

## Implementation

3 จุด (ดู `docs/superpowers/specs/2026-09-08-wake-word-handoff.md` สำหรับรายละเอียดเต็ม):

1. `frontend-character/src/hooks/useVoiceSocket.ts` — `connect(options?: { greetFirst?: boolean })`
   ส่ง `{"type":"greet_first"}` ผ่าน WS ตอน `ws.onopen` ถ้า `greetFirst` true
2. `frontend-character/src/App.tsx` — เฉพาะ `useWakeWord`'s `onDetected` ส่ง `{ greetFirst: true }`
   ปุ่ม "เริ่มคุย" (`LiveVoicePanel`) ไม่ส่ง flag นี้ พฤติกรรมเดิมทุกประการ
3. `backend/app/routers/voice.py` — ข้อความ `greet_first` เรียก
   `session.send_client_content(turns=Content(role="user", parts=[Part(text=...)]),
   turn_complete=True)` ส่ง synthetic turn บอก Gemini ให้ทักทายเอง

## ความเสี่ยงที่คุยกันแล้วและป้องกันไว้

1. **`flag_off_topic` อาจโดนเรียกกับ synthetic turn นี้** เพราะ `SYSTEM_INSTRUCTION` สั่ง "เรียก
   flag_off_topic ก่อนเสมอ" แบบไม่มีข้อยกเว้น ทั้งที่ trigger บอกไว้ว่า "ห้ามเรียก tool ใดๆ" — คำสั่ง
   ขัดกันในบริบทเดียวกัน แก้ด้วย `greet_pending` flag ฝั่ง backend กัน off_topic แรกไม่ให้ทำหน้าโกรธ
   ผู้ใช้ทันทีที่ตื่นถ้าโมเดลตีความผิด **แก้เพิ่มรอบสอง (code review 2026-09-11 บ่าย):** เดิม flag นี้
   เคลียร์แค่ตอน `flag_off_topic` ถูกเรียกเอง — เคสปกติที่สุด (Gemini ทักทายเฉยๆ ไม่เรียก tool อะไรเลย)
   จะไม่มีใคร consume flag เลย ค้าง `True` ไปตลอด session แล้วกลืนคำถามนอกขอบเขต**จริง**ครั้งแรกของ
   ผู้ใช้ไปด้วย (off-topic detection พังไป 1 ครั้งเสมอ) แก้โดยเคลียร์ที่ `speech_start` (ผู้ใช้เริ่มพูด
   จริง = ช่วง synthetic turn จบแน่นอน) และเคลียร์ใน `except` ของ `send_client_content` ด้วย
2. **`send_client_content` ไม่มี try/except เดิม** — พังแล้วจะทำให้ `browser_to_gemini` task ตาย ทั้ง
   session ต้อง reconnect ทิ้ง resumption handle เดิม (ผู้ใช้ไม่รู้อะไรเลย เห็นแค่แมวเงียบ ตรงข้ามกับที่
   ฟีเจอร์นี้ตั้งใจแก้) — ห่อ try/except เฉพาะจุดนี้แล้ว log แล้วปล่อยผ่านให้ผู้ใช้พูดเองตามปกติแทน
3. **ข้อความ trigger ล็อกภาษาไทยเดิม** ("ทักทายเป็นภาษาไทย") ขัดกับข้อกำหนด CLAUDE.md "รองรับสองภาษา
   ตรวจจับอัตโนมัติ ห้ามล็อกภาษาเดียว" — แก้ข้อความให้ทักทายไทยเป็นค่าเริ่มต้น (สมเหตุสมผลเพราะ wake
   word เป็นวลีไทย) แต่ระบุชัดว่าถ้าผู้ใช้พูดต่อเป็นอังกฤษให้สลับตามได้ ไม่ล็อกทั้งบทสนทนา
4. **แมวโชว์หน้าหลับ/ปากไม่ขยับตอนพูดทักทาย** เพราะ `catState` เป็น `"sleep"` ตอน `ws.onopen` และ
   `toCatFaceState()` เดิมเช็ค `botSpeaking` แค่ใต้ `case "wake"` เท่านั้น — ย้าย `botSpeaking` check
   ขึ้นเหนือ switch ให้ชนะทุก catState (ยกเว้น offTopic) แก้ที่ `App.tsx`

## ยังไม่ได้ยืนยัน (ตาม CLAUDE.md ข้อ 1 ห้ามอ้างว่าทดสอบแล้วถ้าไม่ได้ทำ)

- ไม่มี backend รันอยู่ตอนแก้ ไม่เคยต่อ Gemini Live จริงเลยสักครั้งกับโค้ด `greet_first` นี้
- `google-genai==2.21.0` ที่ pin ใน `requirements.txt` ไม่มีให้ตรวจสอบใน PyPI mirror ที่เข้าถึงได้ตอน
  แก้ (เห็นสูงสุด 1.47.0) — ยืนยัน `send_client_content(turns=, turn_complete=)` จาก signature ของ
  เวอร์ชันล่าสุดที่ติดตั้งได้แทน ไม่ใช่เวอร์ชัน pin จริงเป๊ะๆ
- ไม่รู้ว่า synthetic turn นี้จะกระทบลำดับ `transcript`/`turn_complete` ที่ frontend ฟังอยู่หรือไม่
  (เป็น turn แรกก่อนผู้ใช้พูดจริงเลย ยังไม่เคยมี pattern แบบนี้มาก่อน)
- ต้อง restart backend (โค้ด Python เปลี่ยน) แล้วทดสอบพูดเรียก wake word จริงก่อนเชื่อว่าใช้ได้จริง
