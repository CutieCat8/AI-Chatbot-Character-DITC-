# ADR: บั๊ก "คุยได้แค่รอบเดียวต่อการกดปุ่ม" — วินิจฉัยและแก้ 2 จุด

- **สถานะ:** ตัดสินใจแล้ว แก้แล้ว (2026-09-06)
- **บริบท:** ผู้ใช้รายงานบั๊กจริงใน `frontend-character`: กด "เริ่มคุย" ถามคำถามแรกได้คำตอบปกติทุก
  อย่าง (เสียง/ปากขยับ/เนื้อหา) แต่พอถามคำถามที่สอง แมวขยับเหมือนกำลังฟัง (ไมค์/amplitude ทำงาน)
  แต่ไม่มีคำตอบกลับมาเลย ต้องกด "หยุดคุย" แล้ว "เริ่มคุย" ใหม่ถึงจะถามได้อีกรอบ

## วิธีวินิจฉัย (ตามที่ผู้ใช้กำหนด: 3 สมมติฐาน + differential test)

สามสมมติฐานที่ต้องแยก: (1) เสียงรอบสองไม่ถูกส่งเข้า WS/Gemini เลย (2) ส่งไปแล้วแต่ Gemini ไม่ตอบ
(3) Gemini ตอบแล้วแต่ frontend ไม่เล่น

**รอบที่ 1 — ตัดตัวแปรฮาร์ดแวร์ทิ้งด้วยการทดสอบแยกเดี่ยว:** เปิด Gemini Live session ตรงกับ API
เลย ไม่ผ่านโค้ดแอปสักบรรทัด ยิงเสียง TTS 2 คำถามติดกันในเซสชันเดียว (ไม่มีไมค์/browser/WS เกี่ยวข้อง)
พบว่าพังเหมือนกันทุกครั้ง แม้ตัดตัวแปร half-duplex/tool-calling/transcription config ออกจนเหลือ
config เปลือยที่สุด → **สรุป: บั๊กอยู่ใน session/turn logic ที่ใช้ร่วมกัน ไม่ใช่ frontend/WS โดยเฉพาะ**
(ตรงกับที่ผู้ใช้คาดไว้ล่วงหน้า) ตอบสมมติฐาน (2): ส่งไปแล้ว Gemini ไม่ตอบ

**สาเหตุที่ 1 พบ:** `automatic_activity_detection` (AAD) ของ `gemini-3.1-flash-live-preview` ตรวจจับ
"ผู้ใช้เริ่มพูด" ได้แค่ครั้งแรกของ session เท่านั้น ไม่ re-arm ให้จับรอบสองอัตโนมัติ

**การแก้ที่ 1:** ปิด AAD (`realtime_input_config.automatic_activity_detection.disabled=True`) แล้ว
ส่ง `activity_start`/`activity_end` เองทุกครั้งที่ตรวจพบขอบเขตพูด — ฝั่ง Python ใช้ silero-VAD ที่มีอยู่
แล้ว ฝั่ง browser ใช้ local RMS ที่มีอยู่แล้ว (ส่งเป็น JSON `{"type":"speech_start"|"speech_end"}` ให้
backend แปลงเป็น `activity_start`/`activity_end`)

**รอบที่ 2 — ทดสอบ path จริงหลังแก้ที่ 1 ผ่าน WS จริง (ไม่ใช่แค่เรียก Gemini API ตรง ๆ แบบรอบ 1):**
ยิง 5 คำถามติดกันผ่าน `ws://localhost:8000/api/voice/ws` (container จริง, ไม่ปิด-เปิด connection)
พบว่า**คำถามที่ 2 ยังเงียบสนิทเหมือนเดิม** ทั้งที่ AAD ปิดแล้ว — ใส่ log สองฝั่งยืนยันชัดว่า
`browser_to_gemini` ส่ง `speech_start` → audio chunks → `speech_end` → `activity_start`/`activity_end`
เข้า Gemini ครบถ้วนถูกต้องทุกคำถาม (สมมติฐาน 1 ตกไป: เสียงถูกส่งจริง) แต่ `gemini_to_browser` ไม่มี
log อะไรเลยหลัง Q1 จบ — ไม่ error ไม่มี response object ใด ๆ

**สาเหตุที่ 2 พบ:** อ่าน source `google/genai/live.py` โดยตรง —

```python
async def receive(self) -> AsyncIterator[types.LiveServerMessage]:
    while result := await self._receive():
        if result.server_content and result.server_content.turn_complete:
            yield result
            break
        yield result
```

`session.receive()` เป็น generator ที่ **จบตัวเองทุกครั้งที่เจอ `turn_complete`** (คืนคำตอบแค่ 1 เทิร์น
ไม่ใช่ stream ทั้ง session) โค้ดเดิมทั้งสองไฟล์เรียก `async for response in session.receive():` แค่
ครั้งเดียวโดยไม่มี loop ครอบ พอเทิร์นแรกจบ ฟังก์ชันก็ `return` ไปเลย — ผลกระทบต่างกันตามโครงสร้าง:

- **`routers/voice.py`:** `gemini_to_browser()` (task ที่รอฟัง Gemini) จบตัวเองเงียบ ๆ หลัง Q1 แต่
  `browser_to_gemini()` (อีก task ใน `asyncio.gather`) ยังทำงานต่อปกติเพราะ `gather` ไม่ cancel
  task ที่เหลือ → อาการตรงกับที่ผู้ใช้เห็น: ไมค์/amplitude ทำงานต่อ แต่ไม่มีใครรอฟังคำตอบ Q2 อีกเลย
- **`voice_pipeline_dev.py`:** แย่กว่านั้น เพราะ `await asyncio.wait({mic_task, gemini_task},
  return_when=asyncio.FIRST_COMPLETED)` — พอ `gemini_to_speaker()` จบตัวเองหลัง Q1, `wait()` เห็นว่า
  มี task เสร็จแล้วก็คืนค่าทันที เข้า `finally` cancel ทุก task แล้ว**ปิดทั้ง session ทิ้ง** ตู้จะ
  reconnect session ใหม่แบบเงียบ ๆ ทุกคำถามโดยไม่มี error ใด ๆ ให้สังเกต (เสียหายกว่าที่คิด แม้ผู้ใช้
  จะไม่ทันสังเกตอาการนี้เพราะไม่ได้ทดสอบ path นี้โดยตรง)

**การแก้ที่ 2:** ครอบ `async for response in session.receive():` ด้วย `while True:` ทั้งสองไฟล์
เพื่อเรียก `session.receive()` ใหม่ทุกเทิร์น (ตาม usage pattern ที่ SDK ตั้งใจไว้จริง ๆ)

## ทำไมรอบ 1 (ทดสอบแยกเดี่ยว) ไม่เจอบั๊กที่ 2

สคริปต์ทดสอบแยกเดี่ยว (`isolated_session_test.py`, `five_question_test.py`, ลบไปแล้วหลังใช้เสร็จ)
เขียนแบบเรียก `session.receive()` **ใหม่ทุกคำถาม** อยู่แล้ว (ฟังก์ชัน `collect_turn()` ต่อคำถาม) ซึ่ง
บังเอิญเป็น usage pattern ที่ถูกต้องตาม SDK ตั้งแต่แรก เลยไม่มีทางเจอบั๊กที่ 2 เลยไม่ว่าจะทดสอบกี่
คำถามก็ตาม — บั๊กที่ 2 โผล่มาได้ก็ต่อเมื่อทดสอบ "โครงสร้างจริง" ของโค้ดโปรดักชัน (single continuous
receive loop ตลอด session) เท่านั้น เป็นเหตุผลที่ต้องทำการทดสอบรอบ 2 ผ่าน WS จริง ไม่ใช่หยุดแค่
ผลบวกจากการทดสอบแยกเดี่ยวรอบแรก

## รีวิวรอบแรกพบปัญหาเพิ่ม (reviewer subagent, 2026-09-06) — แก้แล้วทั้งหมด

หลังแก้ 2 จุดข้างบนและทดสอบผ่าน 5/5 ครั้งแรก เรียก reviewer subagent ตรวจตามกฎข้อ 7 ของ
CLAUDE.md พบปัญหาจริงเพิ่มอีก 3 จุดที่ต้องแก้ก่อนไปต่อ (ไม่ใช่แค่ nitpick):

1. **`wasSpeechRef` ค้าง `true` ข้ามรอบ half-duplex mute** — `useVoiceSocket.ts`: `if
   (isBotSpeaking()) return;` อยู่ก่อนโค้ดส่ง speech_start/end ทั้งหมด ถ้าผู้ใช้พูดคาบเกี่ยวจังหวะที่
   เสียงแมวเริ่มเล่นจริง (เป็นไปได้ง่ายเพราะ jitter buffer 1.5s ทำให้ `isBotSpeaking()` ขึ้น true ช้า
   กว่าเสียงจริงมาถึง) buffer สุดท้ายก่อนโดน mute จะตั้ง `wasSpeechRef=true` ค้างไว้โดยไม่มีใครส่ง
   `speech_end`/รีเซ็ต พอเปิดไมค์กลับมาแล้วถามคำถามใหม่จริง ๆ เงื่อนไข `isSpeech && !wasSpeechRef`
   จะเป็น false ตลอด → ไม่ส่ง `speech_start` เลย → เงียบสนิท (**บั๊กเดิมกลับมาผ่านทางอ้อม**) — แก้โดย
   ส่ง `speech_end` + รีเซ็ต ref ทันทีตรงจุดที่โดน mute ถ้ามี state พูดค้างอยู่
2. **ไม่มี hangover/hysteresis ทั้งสองฝั่ง** — buffer เงียบแค่ 1 ครั้ง (~85ms ฝั่ง browser, ~32ms ฝั่ง
   Python VAD) ก็ส่ง `speech_end`/`activity_end` ทันที ตัดกลางประโยคที่มีช่วงเว้นวรรค/หายใจสั้น ๆ ได้
   ง่ายมาก — แก้โดยเพิ่ม hangover ~500ms (นับ buffer/เฟรมเงียบติดกันก่อนยืนยันว่าจบจริง) ทั้ง
   `useVoiceSocket.ts` และ `voice_pipeline_dev.py`
3. **`static/voice_test.html` จะพังทันทีจากการแก้นี้** — ไม่เคยส่ง speech_start/end เลย พอ backend
   ปิด AAD แล้วจะไม่ได้คำตอบแม้แต่เทิร์นแรก ทั้งที่ docstring ของ `voice.py` เองอ้างว่าเป็น "ตัวอย่าง
   client ที่ใช้งานได้จริง" — แก้โดยเพิ่ม RMS+hangover logic แบบเดียวกับ `useVoiceSocket.ts`

รวมถึงแก้อีก 2 จุดที่ reviewer ตั้งข้อสังเกตไว้ใน "ควรรู้ไว้": เพิ่ม `input_audio_transcription`
พร้อม `language_codes=["th-TH","en-US"]` ใน `routers/voice.py` (ตกหล่นไปจาก `voice_pipeline_dev.py`
ที่มีอยู่แล้ว ขัดกับกฎ CLAUDE.md ที่ห้าม auto-detect เปิดกว้าง) และแก้ `asyncio.gather` ใน
`voice.py` ให้ cancel task ที่เหลือเสมอเมื่ออีก task จบ/error (เดิมพอ `gemini_to_browser` กลายเป็น
`while True` ไม่มีทางออกแล้ว ถ้า `browser_to_gemini` disconnect ก่อน จะเหลือ task ค้างพยายาม
`session.receive()` ต่อบน session ที่ปิดไปแล้ว กลายเป็น "Task exception was never retrieved")

**เหตุผลที่ 3 จุดนี้ไม่โผล่ตอนทดสอบรอบแรก:** reviewer ชี้ว่าการทดสอบ WS client จำลองส่ง
`speech_start`/`speech_end` **แบบ hardcode ครั้งเดียวต่อคำถาม** ไม่ใช่ผลจาก RMS จริงที่กระเพื่อมขึ้น
ลงหลายสิบครั้งต่อวินาทีเหมือนเสียงคนพูดจริง เลยไม่มีทางเจอบั๊ก hangover/half-duplex-mute-race ได้เลย
ไม่ว่าจะยิงกี่คำถามก็ตาม — สองบั๊กนี้จะโผล่เฉพาะตอนทดสอบด้วยไมค์จริงเท่านั้น (ยังไม่ได้ทำ ดูหัวข้อ
ถัดไป)

## ผลการทดสอบสุดท้ายหลังแก้ทุกจุด (รวมของ reviewer)

ยิง 5 คำถามติดกัน (`DITC คืออะไร`, `ค่าเทอมสาขา SE`, `MMIT เรียนอะไร`, `CAMT อยู่ที่ไหน`,
`ขอบคุณครับ`) ผ่าน `ws://localhost:8000/api/voice/ws` จริง (container `ditc_backend`) ในการเชื่อมต่อ
เดียวโดยไม่ปิด-เปิดใหม่เลย บนโค้ดชุดสุดท้ายหลังแก้ทุกจุดข้างบนแล้ว: **5/5 เทิร์นครบ ได้คำตอบสอดคล้อง
กับคำถามทุกข้อ** — บันทึก transcript ไว้ในผลทดสอบ (ดูด้านล่าง ไม่ได้เก็บไฟล์ไว้เพราะเป็นสคริปต์
ทดสอบชั่วคราวที่ลบตามธรรมเนียมของโปรเจคนี้แล้ว)

**สิ่งที่ยังไม่ได้พิสูจน์ (ตามกฎข้อ 1 ของ CLAUDE.md):** ทดสอบด้วยไฟล์เสียง TTS ผ่าน WebSocket client
จำลอง (speech_start/end ส่งแบบ hardcode ไม่ใช่จาก RMS/VAD จริง) ไม่ใช่ไมค์จริง/เบราว์เซอร์จริง/
ผู้ใช้จริงกดปุ่มจริง โดยเฉพาะจุดที่ 1 กับ 2 ในรีวิวข้างบน (half-duplex mute race + hangover) **แก้
ตามหลักการที่ถูกต้องแล้วแต่ยังไม่เคยพิสูจน์ด้วยเสียงคนพูดจริงที่มีจังหวะเว้นวรรค/คาบเกี่ยวกับเสียงแมว
จริง ๆ** — ยังต้องมีคนทดสอบจริงบนเบราว์เซอร์ (หรือบนแท็บเล็ตจริง) ถาม 5 คำถามติดกันโดยไม่กดปุ่มใหม่
ก่อนถือว่าบั๊กนี้ปิดสมบูรณ์

## ไฟล์ที่เกี่ยวข้อง

- `backend/app/routers/voice.py` — แก้ทั้ง 2 จุด (AAD + while True ครอบ receive loop) + เปลี่ยน
  `browser_to_gemini` ให้รับ JSON `speech_start`/`speech_end` จาก browser แทนที่จะพึ่ง AAD
- `backend/app/scripts/voice_pipeline_dev.py` — แก้ทั้ง 2 จุดเหมือนกัน ฝั่ง trigger activity คือ
  silero-VAD ที่มีอยู่แล้วแทน local RMS
- `frontend-character/src/hooks/useVoiceSocket.ts` — เพิ่ม local RMS speech-boundary detection
  ส่ง JSON ให้ backend (ไม่มีการเปลี่ยน half-duplex logic เดิม)
