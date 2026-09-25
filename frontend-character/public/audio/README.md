# เสียงทักทายตอนปลุก

เมื่อผู้ใช้พูดคำปลุก หน้า Character จะเล่นเสียง Gemini Despina ที่บันทึกไว้ล่วงหน้าจาก
`audio/greetings/` โดยไม่ส่ง synthetic turn เข้า Gemini Live session จริง

- มี 11 ไฟล์ WAV: PCM16, mono, 24 kHz
- เลือกด้วย shuffle bag: เล่นครบทุกไฟล์ก่อนวนรอบใหม่ และไม่ซ้ำติดกันข้ามรอบ
- metadata และ viseme timeline อยู่ที่ `src/lib/greetingManifest.json`
- frontend preload ไฟล์ทั้งหมดและปิดการส่งไมค์ตั้งแต่เริ่มโหลดจนพ้น echo tail หลังเสียงจบ
- หากโหลดไฟล์ไม่สำเร็จ ระบบข้าม greeting แต่ยังเปิดบทสนทนาต่อได้

ไฟล์ tone 440 Hz เดิมถูกนำออกแล้ว การแก้ข้อความหรือสร้างเสียงใหม่ต้องทำบน branch ทดลอง
`experiment/gemini-greeting-capture` แล้วนำเฉพาะ WAV ที่ผ่านการฟังตรวจพร้อม timeline ใหม่เข้ามา
ผ่าน feature branch แยกต่างหาก
