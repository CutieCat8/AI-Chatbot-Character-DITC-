# Wake Word "สวัสดี ditc" — Handoff Notes (updated 2026-09-11)

อ่านคู่กับ `docs/superpowers/specs/2026-09-08-wake-word-design.md` ซึ่งเป็น design ที่ผู้ใช้ approve
แล้ว เอกสารนี้บันทึกสถานะจริงเพื่อให้ agent/session ถัดไปทำต่อได้โดยไม่เดาบริบท

## สถานะสำคัญ

- Branch: `debug/voice-click-noise-investigation`
- งาน voice ที่ push แล้ว: `ed833b4 fix(voice): keep recovery margin out of half-duplex`
  - ลบ `click-noise-debug` logging
  - recovery margin ยังช่วยจัดคิวเสียง แต่ไม่ mute ไมค์ใน margin silence
- **งาน wake-word ทั้งหมดยัง uncommitted และยังไม่ push** ห้ามรวมเข้ากับ commit/PR งาน voice โดยไม่
  ขอผู้ใช้ก่อน
- โมเดลยัง **ไม่ผ่าน production gate** ห้ามเปิด wake-word เป็น default ของ kiosk
- **⚠️ 2026-09-11 บั๊กใหญ่สุดของทั้งฟีเจอร์ (อ่านหัวข้อ "บั๊กรากลึกกว่าที่คิด" ด้านล่างก่อนทำอะไรต่อ):**
  โมเดล wake-word ไม่เคยโหลดขึ้นเบราว์เซอร์จริงได้เลยตั้งแต่ฟีเจอร์นี้เริ่มมี (Keras 3 export format
  ไม่ตรงกับ `@tensorflow/tfjs` — แก้แล้วด้วย `TF_USE_LEGACY_KERAS=1` + strip SeparableConv2D fields
  ใน `train.py`/`export_tfjs.py`) **โมเดลเก่าทุกตัวที่เคย export ก่อนวันนี้ใช้ไม่ได้ ต้อง retrain ใหม่
  จาก `train.py` เท่านั้น (export ซ้ำจาก `.keras` เดิมไม่ช่วย)**
- **2026-09-11: เปลี่ยน window ความยาวจาก 1.6s → 2.0s** ตามคำขอผู้ใช้ (เผื่อ margin คนพูดช้า) แก้พร้อมกัน
  3 จุด (`generate_dataset.py` CLIP_SECONDS, `train.py` CLIP_SAMPLES/input shape 79→99 frames,
  `wakeWordFeatures.ts` WAKE_WORD_SAMPLES) รวมถึง `useWakeWord.ts` ที่มีค่า 1.6 ฮาร์ดโค้ดแยกอีกจุด
  (ไม่ได้ derive จาก constant เดิม) แก้เป็น `WINDOW_SECONDS = WAKE_WORD_SAMPLES / WAKE_WORD_SAMPLE_RATE`
  แล้ว **11 ไฟล์ WAV เดิมใน `~/Downloads` (7 positive/4 negative) ใช้ไม่ได้แล้ว** ยาวไม่ตรง window ใหม่
  ต้องอัดใหม่ทั้งหมด — ยังไม่ได้รัน `add_recorded_samples.py`/`train.py` ซ้ำหลังแก้ค่านี้
- **2026-09-11 ผลตรวจจาก reviewer subagent หลังแก้ window (สำคัญ อ่านก่อนทำต่อ):**
  - **โมเดล dev เดิมที่ `public/models/wake-word-dev/model.json` ใช้ไม่ได้แล้ว** (shape `[None,79,40,1]`
    เก่า ไม่ตรงกับ `[1,99,40,1]` ใหม่) `?wakeword=1` จะ predict ไม่ได้จนกว่าจะเทรน+export โมเดลใหม่
    — แก้ error-handling ใน `useWakeWord.ts` แล้วให้ catch กรณีนี้ถูกต้อง (เดิม exception หลุดจาก
    try/catch ของ `start()` เพราะอยู่ใน `setInterval` callback คนละ scope ทำให้ status ค้างโชว์
    "listening" หลอกๆ, console spam, tensor รั่วทุก 400ms) ตอนนี้ catch แล้ว dispose tensor ใน
    `finally`, ตั้ง `status: "error"` และ `stop()` interval ให้ถูกต้อง — **แต่ยังไม่ได้เทสรันจริงกับ
    ไมค์จริงว่า error path นี้ทำงานถูกจริง** (ตาม CLAUDE.md ข้อ 1 ห้ามรายงานว่าทดสอบแล้วถ้าไม่ได้ทำ)
  - `npm run build`/`npm test` ที่ผ่าน **ไม่ได้พิสูจน์ wake-word ทำงานถูก** — เทสที่มีอยู่ทั้งหมดเป็นเรื่อง
    click-noise ไม่มีเทส wake-word เลย build คือ type-check ไม่ได้รัน `model.predict` จริง
  - ชุด synthetic เดิม `/private/tmp/wake-word-full` (432 positive/2,288 negative ตามที่บันทึกไว้ก่อน
    หน้านี้) เป็น 1.6s ทั้งหมด ใช้กับ `train.py` ใหม่ไม่ได้ (`load_clip` จะ raise ทันทีเพราะขนาดไม่ตรง)
    **ต้อง regenerate ทั้งหมดใหม่ผ่าน edge-tts** — ยังไม่มีตัวเลขเวลาที่ต้องใช้ บอกผู้ใช้ก่อนรันจริง
  - `add_recorded_samples.py` เจอไฟล์ผิดขนาดจะ `raise SystemExit` ทันที ไม่ข้าม — ถ้าอัดไฟล์ใหม่ลง
    `~/Downloads` แล้วมีไฟล์เก่าปนอยู่ (ตอนนี้ลบหมดแล้วก็จริง แต่เป็นความเปราะของสคริปต์ที่ยังไม่ได้แก้)
    ต้องเช็คโฟลเดอร์ให้สะอาดก่อนรันทุกครั้ง
  - `WakeWordRecorder.tsx` อัด 5s แล้วตัดจาก onset−0.20s ยาว 2.0s (เดิม 1.6s) — ถ้าเริ่มพูดหลัง ~3.2
    วินาทีเข้าไปในคลิป 5s ปลายคลิปจะถูก pad เป็นศูนย์แทน ไม่มี validation เตือน คนอัดต้องเริ่มพูดเร็ว
  - **ยังไม่มีหลักฐานว่าขยาย window เป็น 2.0s ช่วยเรื่อง recall จริง** (ผลเดิม TP 1/FN 89 ที่เทรน 1.6s)
    reviewer ชี้ว่าอาจทำให้แย่ลงอีกจาก zero-padding ที่มากขึ้นและ `GlobalAveragePooling2D` เจือจาง
    feature ของเสียงพูดจริง — ต้องเทรนแล้ววัดตัวเลขจริงก่อนสรุปว่าช่วยหรือไม่
  - **`stop()` ใน `useWakeWord.ts` ไม่ idempotent เดิม — แก้แล้ว 2026-09-11 (reviewer รอบสองจับได้):**
    catch path ใหม่ใน interval เรียก `stop()` แล้ว effect cleanup เรียก `stop()` ซ้ำอีกครั้งตอน unmount
    → `model.dispose()`/`audioContext.close()` ครั้งที่สอง throw/reject จริง (ยืนยันด้วย tfjs 4.22)
    → throw จาก effect cleanup ทำให้ React error ทั้งต้นไม้ (ไม่มี error boundary ใน `App.tsx`) จอขาว
    ทั้งหน้ารวมปุ่ม Start Conversation ด้วย — เคสนี้เกิดง่ายมากเพราะโมเดล dev พังทุก tick อยู่แล้วตอนนี้
    แก้ด้วย flag `stopped` กัน `stop()` ทำงานซ้ำ — **ยังไม่ได้ทดสอบกับไมค์จริงว่าไม่ crash จริง** ทดสอบ
    ด้วย mock ผ่าน react-dom เท่านั้น
  - วลี positive ที่ใช้เทรนจริงคือ 6 รายการใน `generate_dataset.py` POSITIVE_TEXTS (ไม่ใช่ 4 ตามที่
    เขียนพลาดไว้ในเวอร์ชันก่อนหน้าของเอกสารนี้ — reviewer รอบสอง 2026-09-11 จับได้ว่า list จริงมี
    "สวัสดีค่ะดีไอทีซี"/"สวัสดีครับดีไอทีซี" เพิ่มด้วย) **ไม่มีคำว่า "แคท"** — ผู้ใช้ยืนยันแล้ว 2026-09-11
    และแก้ CLAUDE.md ให้ตรงแล้ว (เดิม CLAUDE.md เขียนวลีผิดเป็น "สวัสดีดิตซีแคท") — อย่า list วลีซ้ำใน
    เอกสาร ให้ชี้ไปที่ `generate_dataset.py` ตรงๆ เพื่อกันหลุดตามกันอีก
  - **train/serve normalization mismatch ที่ยังไม่ได้แก้ (reviewer รอบสองเจอ):**
    `WakeWordRecorder.tsx` normalize peak amplitude ของเสียงที่อัดเป็น dataset ให้ขึ้นไปที่ ~0.8 ก่อน
    เซฟเป็น WAV แต่ `useWakeWord.ts` ตอน inference จริงป้อนเสียงดิบจากไมค์เข้า `logMelTensor` โดยไม่
    normalize เลย — เป็นคำอธิบายที่เป็นไปได้พอๆ กับเรื่องขนาด dataset ว่าทำไม "ผลทดลองโมเดล" ด้านบนถึง
    ตรวจจับไม่แม่นบนเสียงจริง ยังไม่ได้แก้ ต้องคุยกับผู้ใช้ก่อนว่าจะ normalize ฝั่ง inference ให้ตรงกัน
    ไหม (ย้าย `normalizeForDataset` จาก `WakeWordRecorder.tsx` ไปไว้ใน `wakeWordFeatures.ts` แล้วเรียก
    ใช้ทั้งสองฝั่ง)
  - **bundle รวมตอนนี้ 1.76MB (gzip 306KB) เพราะ `@tensorflow/tfjs` ถูก import แบบ static** ผ่าน
    `App.tsx → useWakeWord.ts` — ทุกคนที่เปิดหน้าตู้ (ไม่ใช่แค่คนใส่ `?wakeword=1`) โหลด tfjs ทั้งก้อน
    ก่อนหน้านี้ไม่มี tfjs เลย (ยังไม่ได้วัด baseline ก่อนหน้าที่แน่ชัดว่าต่างกันกี่ MB) ถ้าจะ commit เข้า
    production ควรทำ dynamic `import()` ให้โหลดเฉพาะตอนเปิดใช้ wake-word จริง
  - `WakeWordRecorder.tsx` dropdown มีตัวเลือก positive แบบเดียว ("สวัสดี ดี ไอ ที ซี") ทั้งที่ต้องอัด
    สลับหลายวลี และชื่อไฟล์ที่ดาวน์โหลดไม่บันทึกว่าพูดวลีไหน — ตรวจย้อนหลังไม่ได้ว่าชุดที่อัดสมดุลไหม

## สิ่งที่ทำแล้ว (ยัง uncommitted)

### Training pipeline

อยู่ที่ `backend/app/scripts/wake_word/`

- `generate_dataset.py`: TTS synthetic data, concurrency 2, retry/backoff, ตรวจ MP3 และ resume ได้
- `train.py`: log-mel 40 bins, CNN, grouped split, strict gate: zero false accepts, precision >= .95,
  recall >= .50
- `export_tfjs.py`: export Keras เป็น TF.js และ reject หาก >200KiB
- `add_recorded_samples.py`: เติม WAV ที่อัดจาก browser พร้อม augmentation
- `.venv/` อยู่ใน directory นี้และถูก ignore

ชุด synthetic เต็มเดิมอยู่ `/private/tmp/wake-word-full` (432 positive, 2,288 negative) เป็น temporary
data ไม่ควรถือว่ามีอยู่เสมอ

### Frontend

- เพิ่ม `frontend-character/src/hooks/wakeWordFeatures.ts` และ `useWakeWord.ts`
- เพิ่ม `WakeWordRecorder.tsx`: URL `?wakeword=1` บันทึก WAV 16kHz/2.0s ได้ (เดิม 1.6s ก่อน
  2026-09-11 — ดูหัวข้อ "สถานะสำคัญ")
- `App.tsx` มี manual test mode ที่ `http://127.0.0.1:5174/?wakeword=1`
  - dev model `/models/wake-word-dev/model.json`
  - diagnostic listener status, confidence, consecutive hits
  - recorder หยุด listener ชั่วคราว กันใช้ไมค์ซ้อนกัน
- `@tensorflow/tfjs` ถูกเพิ่มใน package/lockfile
- dev model ถูก ignore ที่ `frontend-character/public/models/wake-word-dev/`

### Cat state ที่ยัง uncommitted

`useVoiceSocket.ts` ถูกแก้เพิ่มให้เริ่ม/กลับไป `sleep` เพื่อ kiosk ไม่ลืมตาตอนยังไม่มี session การแก้นี้
**ยังไม่อยู่ใน `ed833b4`**

## 2026-09-11 greet-first: แมวทักทายก่อนเองตอนตื่นจาก wake-word (ยังไม่ได้ทดสอบจริง)

ผู้ใช้ขอเพิ่ม: ตอนนี้ผู้ใช้เรียก wake word แล้วต้องพูดก่อนแมวถึงจะตอบ (นั่งรอเงียบๆ) อยากให้แมวทักทาย
ก่อนเอง **เฉพาะทาง wake-word เท่านั้น** ไม่ใช่ปุ่ม "เริ่มคุย" (ยืนยันชัดเจนจากผู้ใช้โดยตรง แม้จะขัดกับ
หลักการเดิมใน design spec ที่ว่า "ไม่มี code path แยก กันพฤติกรรมสองทางไม่ตรงกัน" — บันทึกเป็นข้อยกเว้น
ที่ตกลงแล้วไว้ใน design doc ตรงหัวข้อนั้นแล้ว)

**Implementation (3 จุด):**
1. `frontend-character/src/hooks/useVoiceSocket.ts` — `connect()` รับ `options?: { greetFirst?:
   boolean }` เพิ่ม ตอน `ws.onopen` ถ้า `greetFirst` true จะส่ง `{"type":"greet_first"}` ผ่าน WS
2. `frontend-character/src/App.tsx` — `useWakeWord`'s `onDetected` เปลี่ยนจาก `voice.connect()` เฉยๆ
   เป็น `voice.connect({ greetFirst: true })` (ปุ่ม "เริ่มคุย" ที่ `LiveVoicePanel` เรียกยังเป็น
   `voice.connect` เฉยๆ ไม่เปลี่ยน)
3. `backend/app/routers/voice.py` — `browser_to_gemini()` เพิ่ม branch จับ `type: "greet_first"` เรียก
   `session.send_client_content(turns=types.Content(role="user", parts=[types.Part(text=...)]),
   turn_complete=True)` ส่ง synthetic turn บอก Gemini ให้ทักทายเอง — ใช้ `send_client_content` ไม่ใช่
   `send_realtime_input` เพราะไม่มีเสียงจริงจากผู้ใช้ ข้อความ trigger ระบุชัดว่า "ห้ามเรียก tool ใดๆ"
   กันโมเดลพยายาม `search_camt_knowledge_base` ทั้งที่ไม่มีคำถามจริง (`SYSTEM_INSTRUCTION` บังคับเรียก
   tool ก่อนตอบทุกคำถามปกติ)

**ยืนยันแล้ว:** `google-genai` SDK มี `send_client_content(turns=, turn_complete=)` จริง (เช็ค signature
ตรงจาก source ของ SDK เวอร์ชันล่าสุดที่ pip มี ไม่ใช่เดา — เวอร์ชัน pin ใน `requirements.txt` คือ
`google-genai==2.21.0` ซึ่งไม่มีใน PyPI mirror ที่เครื่องนี้เข้าถึงได้ตอนตรวจ (เห็นสูงสุดแค่ 1.47.0)
เลยตรวจ signature จากเวอร์ชันล่าสุดที่ติดตั้งได้แทน — ตัว method นี้เสถียรมาตั้งแต่ SDK รุ่นแรกๆ ของ Live
API ไม่น่าเปลี่ยน แต่ยังไม่ได้ยืนยันกับเวอร์ชัน pin จริงเป๊ะๆ) `python3 -m py_compile` ผ่าน `npm run
build`/`npm test` ผ่าน (19 tests เดิม)

**⚠️ ยังไม่ได้ทดสอบด้วยของจริงเลย** (ตาม CLAUDE.md ข้อ 1 ห้ามอ้างว่าทดสอบแล้วถ้าไม่ได้ทำ) — ไม่มี
backend รันอยู่ตอนแก้ ไม่ได้ต่อ Gemini Live จริง ไม่รู้ว่า:
- `send_client_content` จะทำให้ Gemini ตอบจริงในจังหวะที่ต้องการไหม (อาจชนกับ turn อื่นถ้า session
  ยังไม่ settle เต็มที่ตอน `ws.onopen`)
- ข้อความ trigger จะทำให้แมวพูดธรรมชาติพอไหม หรือฟังดูแปลกๆ
- มีผลข้างเคียงกับ transcript/turn_complete flow ที่ frontend ฟังอยู่ไหม (เพิ่ง prefill turn หนึ่งก่อน
  ที่ผู้ใช้จะพูดจริง อาจกระทบลำดับ state ที่ `useVoiceSocket.ts` คาดไว้)

ต้อง restart backend (โค้ด Python เปลี่ยน) แล้วทดสอบพูดเรียก wake word จริงบนแท็บเล็ต/เบราว์เซอร์ก่อน
จะเชื่อว่าใช้ได้

**2026-09-11 บ่าย — reviewer subagent ตรวจ greet-first เจอบั๊กจริง 4 จุด แก้แล้วทั้งหมด** (ดู
`docs/adr/wake-word-greet-first.md` สำหรับรายละเอียดเต็มของแต่ละจุด):
1. `greet_pending` flag ใน `voice.py` — กัน `flag_off_topic` แรกไม่ให้ทำหน้าโกรธผู้ใช้ทันทีที่ตื่น
2. `try/except` ครอบ `send_client_content` — กัน exception ทำ session ทั้งอันตาย/reconnect ทิ้ง
   resumption handle
3. แก้ข้อความ trigger ที่ล็อกภาษาไทยตายตัว (ขัด CLAUDE.md ข้อ "ห้ามล็อกภาษาเดียว")
4. `toCatFaceState()` ใน `App.tsx` — ย้าย `botSpeaking` check ขึ้นเหนือ switch กันแมวโชว์หน้าหลับ/ปาก
   ไม่ขยับตอนพูดทักทาย (catState ยังเป็น `sleep` ตอนเริ่มพูด)

reviewer ยังเจอเพิ่ม (แก้แล้วเช่นกัน): `onConnect={voice.connect}` ที่ `LiveVoicePanel` ส่ง `MouseEvent`
เป็น arg แรกให้ `connect()` โดยไม่ตั้งใจ (รอดอยู่เพราะ `options?.greetFirst` เป็น undefined แต่เสี่ยงพัง
ถ้าเพิ่ม option อื่นทีหลัง) แก้เป็น `onConnect={() => voice.connect()}`

และเพิ่ม defensive gate ใหม่ใน `export_tfjs.py` (`_assert_browser_compatible()`) เช็ค `keras_version`
ขึ้นต้น "2.", `InputLayer` มี `batch_input_shape`, ไม่มี `SeparableConv2D` เหลือคีย์ `kernel_*` — ทดสอบ
แล้วว่า raise จริงถ้าจำลอง regression กลับไปเป็น Keras 3 (กันบั๊กที่เพิ่งเสียเวลาทั้งวันไม่ให้กลับมาเงียบๆ
อีกโดยไม่มีสัญญาณเตือนตอน export)

**รอบตรวจซ้ำครั้งที่ 2 (2026-09-11 บ่าย) เจอบั๊กจริงอีก 1 จุด แก้แล้ว:** `greet_pending["active"]`
เดิมเคลียร์แค่ตอน `flag_off_topic` ถูกเรียกเอง — เคสปกติที่สุด (Gemini ทักทายเฉยๆ ไม่เรียก tool อะไร
เลย) ไม่มีใคร consume flag ค้าง `True` ตลอด session แล้วกลืนคำถามนอกขอบเขต**จริง**ครั้งแรกของผู้ใช้ไป
ด้วย แก้โดยเคลียร์ที่ `speech_start` (ผู้ใช้เริ่มพูดจริง = จบช่วง synthetic turn แน่นอน) และเคลียร์ใน
`except` ของ `send_client_content` ด้วย — รอบนี้ reviewer ยืนยันว่าไม่มี race (ตั้ง flag ก่อน await
ในลูปเดียวกัน) และ try/except ไม่กลืน error สำคัญอื่น (ไม่จับ `CancelledError`)

**ทั้งหมดนี้ยังไม่ได้ทดสอบกับ Gemini Live จริงเช่นกัน** เหมือนที่ ADR ระบุไว้

## 2026-09-11 บั๊กรากลึกกว่าที่คิด: โมเดล wake-word ไม่เคยโหลดขึ้นเบราว์เซอร์จริงได้เลยตั้งแต่แรก

หลังสรุป root cause เรื่อง false-accept ผิดๆ ไปแล้ว (หัวข้อถัดไปด้านล่าง อธิบายว่าทำไมถึงเดาผิด) สืบ
ต่อตามหลักฐานจริง (`listener: error` ขึ้นเองภายใน 3-5s ตั้งแต่เปิดหน้า **ไม่เคยเห็น mic permission
prompt เลยแม้แต่ครั้งเดียวจาก wake-word เอง**) พบว่า **`tf.loadLayersModel()` fail ทุกครั้ง** ก่อนจะ
ไปถึง `getUserMedia` เลยด้วยซ้ำ — พิสูจน์ด้วยการเขียนเทสจริงโหลด `model.json` ผ่าน `@tensorflow/tfjs`
เวอร์ชันเดียวกับที่ frontend ใช้ (ไม่ใช่แค่อ่านโค้ดเดา):

**สาเหตุที่ 1 — Keras 3 vs tfjs-layers 4.22 schema ไม่ตรงกัน:** `train.py`/`export_tfjs.py` รันบน
Keras 3.10.0 (ค่า default ของ `tensorflow==2.16.2`) ซึ่ง serialize `InputLayer` ด้วยคีย์ `batch_shape`
และโครงสร้าง `inbound_nodes` แบบใหม่ (object แทน array) — `@tensorflow/tfjs@4.22.0` (เขียนรองรับ
Keras 2 schema) อ่านไม่ออก throw `ValueError: An InputLayer should be passed either a
batchInputShape or an inputShape` ทันที **แก้ด้วย `os.environ.setdefault("TF_USE_LEGACY_KERAS", "1")`
ก่อน `import tensorflow`** ใน `train.py` และ `export_tfjs.py` ทั้งคู่ (ต้องตั้งก่อน import เท่านั้น
ถึงจะมีผล) — `tensorflowjs` package เองก็ depend on `tf_keras` อยู่แล้วเป็นหลักฐานว่าถูกออกแบบมาให้ใช้
legacy Keras ไม่ใช่ native Keras 3 **ข้อควรระวัง: โมเดลที่ถูก save ด้วย Keras 3 ไปแล้ว (เช่นทุกโมเดลที่
เทรนไปก่อนหน้านี้ในเซสชันนี้) จะโหลดกลับด้วย legacy tf_keras ไม่ได้เลย ต้อง retrain ใหม่ทั้งหมดตั้งแต่
`train.py` ไม่ใช่แค่ export ซ้ำจาก `.keras` เดิม**

**สาเหตุที่ 2 — SeparableConv2D config ไม่ตรงกันอีกชั้น (คนละเรื่องกับ Keras 2/3):** แม้เทรนด้วย legacy
Keras แล้ว ยัง throw `ValueError: Fields kernelInitializer, kernelRegularizer and kernelConstraint are
invalid for SeparableConv2D` — Keras (ทั้ง 2 และ 3) ใส่คีย์ `kernel_initializer`/`kernel_regularizer`/
`kernel_constraint` ที่สืบทอดมาจาก base Conv layer ติดมาด้วยเสมอ (ต่อให้เป็น None) แต่ tfjs-layers
เวอร์ชัน JS ปฏิเสธแค่ "มีคีย์นี้อยู่" เลย ไม่สนใจค่า — **แก้ด้วยฟังก์ชัน
`_strip_separable_conv2d_kernel_fields()` ใหม่ใน `export_tfjs.py`** ที่ post-process `model.json`
หลัง `tfjs.converters.save_keras_model()` ลบ 3 คีย์นี้ออกจากทุก SeparableConv2D layer (เหลือแค่
`depthwise_*`/`pointwise_*` ที่ layer นี้ใช้จริง)

**ยืนยันแล้วว่าโมเดลจริงทำงานได้ทั้ง load และ predict** ผ่าน `@tensorflow/tfjs` เวอร์ชันเดียวกับที่
frontend ใช้จริง (ทดสอบด้วย IOHandler กำหนดเองอ่าน `model.json`+`.bin` ตรงๆ ไม่ผ่าน HTTP แต่ deserializer
เป็นโค้ดเดียวกัน) — export เข้า `public/models/wake-word-dev/model.json` แล้ว (11.5 KiB)

**สรุปที่สำคัญที่สุด: ตั้งแต่ฟีเจอร์นี้เริ่มมีมา (เอกสาร spec วันที่ 2026-09-08) ไม่เคยมีการทดสอบโหลดโมเดล
ในเบราว์เซอร์จริงสักครั้ง — ทุก dev model ที่เคย export ไปก่อนหน้านี้ทั้งหมด (รวมของวันนี้ก่อนเจอบั๊กนี้)
ใช้งานไม่ได้เลยตั้งแต่แรก ไม่ใช่แค่เรื่อง window duration หรือ dataset** บั๊กนี้ซ่อนอยู่เพราะไม่มีใคร
เคยลองเปิด `?wakeword=1` แล้วดู console/`listener:` field อย่างจริงจังมาก่อนวันนี้ — `train.py`/
`export_tfjs.py` แก้ถาวรแล้ว รันซ้ำจากนี้ไปจะได้โมเดลที่โหลดได้เองอัตโนมัติ ไม่ต้อง patch มือ

## 2026-09-11 root-cause: ตื่นตอนพูดคำอื่นที่ไม่ใช่ wake word (การสืบสวนที่พาไปผิดทาง — เก็บไว้เป็น
บันทึกว่าทำไมถึงเดาผิด ไม่ใช่คำอธิบายที่ถูกต้องของปัญหาจริง — ดูหัวข้อด้านบนสำหรับสาเหตุจริง)

ผู้ใช้ทดสอบ interim model (จากหัวข้อ pipeline sanity check ด้านล่าง) ผ่าน `?wakeword=1` จริง แล้วพบว่า
**ตื่นทันทีแม้พูดคำอื่นที่ไม่ใช่ wake word เลย** — สืบตามกระบวนการ systematic-debugging (ห้ามเดา
ตาม CLAUDE.md ข้อ 4):

**Hypothesis ที่ตรวจแล้วและตัดออก (มีหลักฐานจริง ไม่ใช่แค่อ่านโค้ด):** feature-extractor mismatch
ระหว่าง Python (`train.py log_mel`) กับ JS (`wakeWordFeatures.ts logMelTensor`) — รัน parity test จริง
(ป้อน PCM decode เดียวกันเป๊ะจากไฟล์ที่อัดจริง เข้าทั้งสองฟังก์ชัน เทียบตัวเลข [1,99,40,1] ทีละช่อง)
ผล: **max abs diff = 0.0199, mean abs diff = 0.0041** บนช่วงค่าประมาณ -6.3 ถึง +8.4 — ต่างกันแค่ระดับ
floating-point/การคำนวณ mel matrix เล็กน้อย **ไม่ใช่สาเหตุ** ปิด gap ที่ design doc ค้างไว้ได้ (item
"ยังขาด feature-extractor parity test") — parity **ผ่าน** ระดับที่ยอมรับได้

**Root cause ที่มีหลักฐานสนับสนุน:** โมเดล interim ที่ export ไปทดสอบเทรนจาก **เสียงจริง 12 คู่ล้วนๆ
ไม่มี synthetic TTS ผสมเลยแม้แต่ตัวเดียว** — เทียบกับผลทดลองก่อนหน้าในหัวข้อ "ผลทดลองโมเดล" ด้านล่าง
ทุกโมเดลที่เคยผสม synthetic negative จำนวนมาก (TN 372 หรือ 368) **ไม่เคยมี false-accept รั่วแบบนี้เลย**
(FP=0 ที่ .98 ทุกรอบ, FP=3 ที่ .90) เพราะ negative class มีความหลากหลายพอ (ประโยคทั่วไป/เนื้อหา KB/
เสียงเงียบ) ให้โมเดลเรียนรู้ขอบเขตที่แคบพอ ส่วนโมเดล interim รอบนี้เห็น negative แค่ 12 วลีที่ผู้ใช้อัด
เอง (ไม่รู้ครบทุกหมวดตามที่สั่งไปหรือเปล่า) **ไม่มีทางเรียนรู้ที่จะปฏิเสธเสียงพูดไทยทั่วไปได้เลย** จึงมี
โอกาสสูงที่โมเดลจับสัญญาณหยาบๆ เช่น "มีพลังงานเสียงพูดอยู่ในช่วงนี้" แทนเนื้อหาคำพูดจริง

**สรุป: นี่ไม่ใช่บั๊กใหม่จากโค้ดที่แก้รอบนี้ (window 1.6→2.0s, stop() fix ฯลฯ)** เป็นผลที่คาดได้จากการเอา
โมเดลที่ตั้งใจให้เป็นแค่ pipeline sanity-check (ไม่มี synthetic เลย) ไปทดสอบพฤติกรรมจริง — ตรงกับที่
design doc เตือนไว้ตั้งแต่แรกว่าห้ามข้ามไปเฟส 2 ถ้ายังไม่ผ่าน gate เฟส 1 ผมพลาดที่ไม่ได้เตือนผู้ใช้
เรื่องความเสี่ยง false-accept ชัดเจนพอตอนชวนทดสอบ (เตือนแค่เรื่อง recall ต่ำ/ไม่ตื่น ไม่ได้เตือนว่าอาจ
ตื่นมั่วได้เหมือนกัน) **ทางแก้ที่แท้จริงคือต้อง regenerate synthetic dataset + อัด real sample ให้ครบ
เป้าก่อน ไม่ใช่แก้โค้ดโมเดล/threshold** — อย่าปรับ threshold ขึ้นเพื่อกลบอาการนี้โดยไม่มี synthetic
negative ผสม เพราะจะซ่อนปัญหาไม่ใช่แก้ที่ต้นตอ

## 2026-09-11 regenerate synthetic + retrain — ยืนยัน root cause ถูกจริง

หลังหา root cause ได้ (หัวข้อด้านบน) รัน `generate_dataset.py` เต็มรูปแบบใหม่ที่ window 2.0s
(`--out /private/tmp/wake-word-full-2s`, ใช้เวลา TTS จริง 158s รวมทั้งสคริปต์ ~2m44s) ได้ 432
positive/2,288 negative — **จำนวนตรงกับชุดเดิมที่ 1.6s เป๊ะ** (432/2,288 เท่ากัน สม่ำเสมอตามโค้ด)
แล้ว merge เสียงจริง 12+12 คู่เดิมเข้าไปด้วย `add_recorded_samples.py` (+288/+288) รวมเป็น 720
positive/2,576 negative แล้วเทรนที่ `/private/tmp/wake-word-full-2s-model`:

```
{tp: 27, fp: 0, tn: 369, fn: 63, precision: 1.0, recall: 0.3, false_accept_rate: 0.0}
FAILED gate (ต้องการ recall >= 0.50, ได้ 0.3)
```

**ยืนยัน root cause ที่สงสัยไว้ถูกต้อง:** พอมี synthetic negative กลับเข้ามา **FP กลับมาเป็น 0 ทันที**
เหมือนทุกรอบทดลองก่อนหน้าที่มี synthetic ผสม (ดูหัวข้อ "ผลทดลองโมเดล" ด้านล่าง) — ปัญหา "ตื่นตอนพูดคำ
อื่น" หายไปแล้วจากโมเดลนี้ ปัญหาที่เหลือคือ **recall ต่ำ** (พลาดคำเรียก 63/90 ครั้ง) ซึ่งตรงกับที่ design
doc ยอมรับไว้แต่แรกว่า "ยอมรับ false-negative สูงขึ้นได้เพื่อแลกกับ false-accept ต่ำ" — ทิศทางถูกแล้ว
แค่ยังไม่ถึงเกณฑ์ recall >= 0.50

~~**export ไปที่ dev model แล้ว** (`public/models/wake-word-dev/model.json`, 13.3 KiB) ทับตัวเก่าที่
false-accept มั่ว~~ **แก้ไขแล้ว 2026-09-11 บ่าย — ตัวนี้ยังใช้ไม่ได้จริง:** โมเดล 13.3 KiB ตัวนี้เทรน
ด้วย Keras 3 เหมือนโมเดลทุกตัวก่อนหน้านี้ในเซสชันนี้ **โหลดขึ้นเบราว์เซอร์จริงไม่ได้เลย** (ดูหัวข้อ
"บั๊กรากลึกกว่าที่คิด" ด้านล่าง — เจอทีหลังจากตรงนี้) ตัวเลข tp/fp/recall ที่เขียนไว้ข้างบนถูกต้องตามที่
วัดจริง แต่ **ไม่ใช่โมเดลที่ deploy อยู่จริงตอนนี้** — โมเดลที่ deploy จริงคือตัวที่เทรนซ้ำด้วย legacy
Keras (หัวข้อ "บั๊กรากลึกกว่าที่คิด") ได้ผล **recall 0.178** (tp 16/fn 74) ไม่ใช่ 0.30 คนละตัวกัน แม้
dataset จะเหมือนกันเป๊ะ (ตัวเลข recall ต่างกันเพราะ RNG ของ Keras 2 vs 3 ไม่เหมือนกันแม้ fix seed
เดียวกัน — **อย่าเชื่อ recall จากรันเดียวว่าสรุปอะไรได้เรื่อง window 2.0s ช่วยหรือไม่**) ขนาดไฟล์จริงที่
deploy อยู่คือ **11.5 KiB** ไม่ใช่ 13.3 KiB — ทางแก้ต่อไปยังเหมือนเดิม: อัดเสียงจริงเพิ่มให้ถึงเป้า
25–40 positive (ตอนนี้มีแค่ 12) ไม่ใช่แก้ threshold/โค้ดโมเดล

**⚠️ ความเสี่ยงเก็บไฟล์:** `model.keras`/`evaluation.json` ต้นทางของโมเดลที่ deploy จริงอยู่ที่
`/private/tmp/wake-word-legacy-model` เท่านั้น (macOS ลบ `/private/tmp` เองได้ตามรอบ) ไม่มีสำเนาอยู่ใน
repo เลย — ถ้าหายไปต้อง retrain ใหม่จาก `/private/tmp/wake-word-full-2s` (dataset, ก็เป็น temp เหมือน
กัน) ใช้เวลาไม่นาน (train ~23s, ไม่นับเวลา regenerate dataset ถ้า dataset หายไปด้วย ~2m44s)

temp dir ที่ใช้รอบนี้ (`/private/tmp/wake-word-full-2s`, `/private/tmp/wake-word-full-2s-model`,
`/private/tmp/wake-word-quick`) ไม่ควรถือว่ามีอยู่เสมอเหมือนกัน

## 2026-09-11 pipeline sanity check (ไม่ใช่ผลเทรนจริง)

ผู้ใช้อัดเพิ่ม 12 positive + 12 negative raw (2.0s, `~/Downloads`) รัน `add_recorded_samples.py`
(`--out /private/tmp/wake-word-real`, temp dir) ได้ 288 positive + 288 negative augmented clips แล้ว
รัน `train.py --dataset /private/tmp/wake-word-real --out /private/tmp/wake-word-real-model` **เฉพาะ
เพื่อยืนยันว่า pipeline รันได้จริงกับ window 2.0s ใหม่ ไม่ใช่การประเมินโมเดลจริง** — ผลลัพธ์:
`{tp:0, fp:0, tn:48, fn:48}` ที่ threshold .98, **FAILED gate ตามคาด** เพราะ dataset มีแค่เสียงจริง 12
คู่ (ไม่มี synthetic TTS เลย ไม่ผสม negative หลากหลายแบบตาม design spec) ตัวเลขนี้**ไม่มีความหมายอะไร
เกี่ยวกับความแม่นจริง** สิ่งที่พิสูจน์ได้จริงมีแค่: ไม่มี shape error ทั้ง training loop — ยืนยันว่าการ
แก้ 1.6s→2.0s ใช้ได้จริงถึงระดับเทรนจริง ไม่ใช่แค่ type-check ยังต้อง (1) อัด real sample เพิ่มให้ถึงเป้า
25–40/80–100 และ (2) regenerate synthetic dataset ก่อนถึงจะประเมิน gate ได้จริง — temp dir ทั้งสอง
(`/private/tmp/wake-word-real`, `/private/tmp/wake-word-real-model`) ไม่ควรถือว่ามีอยู่เสมอเหมือนกัน

## ผลทดลองโมเดล

1. TTS-only ที่ threshold .98: TP 0 / FP 0 / TN 372 / FN 66
2. ผู้ใช้อัดไฟล์จริงใน `/Users/pordiewtrakul/Downloads`: positive 7, negative 4; ทุกไฟล์ valid
   mono 16kHz/1.6s และไม่ซ้ำ — **ลบไปแล้ว 2026-09-11** (window เปลี่ยนเป็น 2.0s ไฟล์เก่าสั้นไม่พอ
   ผู้ใช้สั่งลบทิ้งตรงๆ) ต้องอัดใหม่ทั้งหมดตามความยาวใหม่ ยังไม่มีไฟล์ใน Downloads เลยตอนนี้
3. เติม augmentation แล้วได้ real positive 168 / negative 96 และเทรนร่วม synthetic
4. ที่ .98: TP 1 / FP 0 / TN 368 / FN 89 — ไม่ผ่าน gate
5. ที่ .90: TP 14 / FP 3 — ใช้ manual experiment ได้เท่านั้น, ห้าม production

ผู้ใช้ลองแล้วไม่ detect reliably ซึ่งสอดคล้องกับผลเทรน ห้ามลด threshold เพิ่ม ต้องเก็บข้อมูลจริงเพิ่ม:

- positive 25–40 ไฟล์: สลับ “สวัสดี ดี ไอ ที ซี”, “สวัสดีดิตซี”, “สวัสดีดิทซี”
- negative 80–100 ไฟล์: เน้น “สวัสดี”, “สวัสดีครับ”, “สวัสดีค่ะ” และเสียงรอบข้างจริง

## วิธีทำต่อ

1. ตรวจ `git status --short` ก่อนเสมอ: มีงาน user อื่นและ wake-word uncommitted อยู่ร่วมกัน
2. อย่า commit/push wake-word ถ้าผู้ใช้ยังไม่ได้สั่งชัดเจน
3. **ต้อง regenerate synthetic dataset ใหม่ทั้งหมดก่อน** (ของเดิมที่ `/private/tmp/wake-word-full`
   เป็น 1.6s ใช้กับ window 2.0s ใหม่ไม่ได้) — บอกผู้ใช้เรื่องเวลาที่ต้องใช้ก่อนรัน:

```bash
backend/app/scripts/wake_word/.venv/bin/python \
  backend/app/scripts/wake_word/generate_dataset.py --out <dataset-dir>
```

4. อัด sample เสียงจริงใหม่ทั้งหมดผ่าน `?wakeword=1` (เป้า positive 25–40 / negative 80–100 — ดูหัวข้อ
   "ผลทดลองโมเดล") **ตรวจ `~/Downloads` ให้ไม่มีไฟล์ wake-word-*.wav ขนาด/ความยาวเก่าปนอยู่ก่อนรัน**
   (`add_recorded_samples.py` เจอไฟล์ผิดขนาดจะ `SystemExit` ทันที ไม่ข้ามให้เอง) แล้วรัน:

```bash
backend/app/scripts/wake_word/.venv/bin/python \
  backend/app/scripts/wake_word/add_recorded_samples.py \
  --samples /Users/pordiewtrakul/Downloads --out <dataset-copy>
```

จากนั้น run `train.py` และอ่าน `evaluation.json` ก่อน export — **บันทึกตัวเลข recall/precision เทียบกับ
ผลเดิมที่ 1.6s (TP 1/FN 89 ที่ .98) ด้วยว่าการขยาย window ช่วยจริงไหม ยังไม่มีหลักฐาน**
5. export TF.js เฉพาะเมื่อ gate ผ่าน (zero false accept, precision ≥ .95, recall ≥ .50) แล้วแทนที่ dev
   model เก่าที่ `public/models/wake-word-dev/` (shape เก่าใช้ไม่ได้แล้วตอนนี้)
6. ยังขาด feature-extractor parity test เปรียบตัวเลข Python/JS ก่อน production
7. **ยังไม่ได้ทดสอบ error path ของ `useWakeWord.ts` ด้วยไมค์จริง** (แก้ catch แล้วแต่ยังไม่เห็นรันจริง)
   — ก่อนบอกว่า "แก้แล้ว" ต้องเปิด `?wakeword=1` จริงดู console + status UI

## ตรวจสอบ

```bash
cd frontend-character
npm run build
npm test
```

**คำเตือน:** ทั้งสองคำสั่งนี้ไม่ครอบคลุม wake-word เลย — `npm test` มีแค่เทส click-noise (
`useVoiceSocket.test.ts`) และ `npm run build` คือ type-check ไม่ได้รัน `model.predict` จริง (เจอบั๊ก
shape mismatch ไม่ได้จากตรงนี้ — ต้องรันจริงในเบราว์เซอร์) ล่าสุด (2026-09-11) ทั้งสองผ่าน แต่นั่นแปลว่า
"โค้ด compile ได้" เท่านั้น ไม่ใช่ "wake-word ใช้งานได้"
