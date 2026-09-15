`greeting.wav` เป็นไฟล์ placeholder (1.2s, tone 440Hz) — เสียงทักทายจริงยังไม่ได้อัด

แทนที่ไฟล์นี้ด้วยเสียงทักทายจริงได้เลย:

- **ตำแหน่ง:** `frontend-character/public/audio/greeting.wav` (ชื่อไฟล์ต้องเหมือนเดิม — ตั้งอยู่ที่
  `GREETING_AUDIO_URL` ใน `frontend-character/src/hooks/useVoiceSocket.ts`)
- **ฟอร์แมต:** อะไรก็ได้ที่ `AudioContext.decodeAudioData()` ของเบราว์เซอร์เล่นได้ (WAV/MP3/OGG ใช้ได้
  หมด) — ถ้าเปลี่ยนเป็นนามสกุลอื่น (เช่น `.mp3`) ต้องแก้ `GREETING_AUDIO_URL` ให้ตรงด้วย
- **เนื้อหาที่แนะนำ:** ทักทายสั้น ๆ 1 ประโยค แนะนำตัวว่าเป็น DITC CAT แล้วถามว่าช่วยอะไรได้บ้าง (เนื้อหา
  เดียวกับที่ `GREET_FIRST_MESSAGE` เดิมเคยสั่งให้ Gemini พูด ก่อนจะเลิกใช้กลไกนั้น — ดู CLAUDE.md)
- **ความยาว:** ไม่จำกัด แต่สั้นกระชับดีกว่า (ไมค์จะถูก mute อยู่ตลอดที่ไฟล์นี้เล่น)
