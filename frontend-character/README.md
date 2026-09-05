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

## รันบนแท็บเล็ตจริงผ่าน LAN (ตู้จริง: Samsung Galaxy Tab S10 FE+, ไมค์+ลำโพงในเครื่องเดียวกัน)

ตู้จริงเปิดแค่หน้านี้ผ่าน Chrome บนแท็บเล็ต ส่วน backend รันอยู่อีกเครื่องในวง LAN เดียวกัน —
มี 3 เรื่องที่ต่างจากตอน dev บนเครื่องเดียวกันชัดเจน แต่ก่อนอย่างอื่นทั้งหมดต้องทำข้อนี้ก่อน:

### ล็อก IP เครื่อง backend (ทำก่อนอย่างอื่นจริง ๆ)

ทุกวิธีด้านล่าง (mkcert ผูก cert กับ IP ตายตัว, `chrome://flags` ก็ระบุ origin เจาะจงเหมือนกัน)
**ถ้า IP เครื่อง backend เปลี่ยนวันงาน ทุกวิธีพังหมด** เลือกทางใดทางหนึ่ง:

- **Static IP บนเครื่อง backend เอง (แนะนำ — ทำได้เองไม่ต้องพึ่งสิทธิ์ router):**
  Settings > Network & Internet > Wi-Fi > คลิกชื่อ Wi-Fi ที่ต่ออยู่ > Edit > IP settings เปลี่ยนจาก
  "Automatic (DHCP)" เป็น "Manual" ใส่ IP ที่ต้องการ (เช่น `192.168.1.50`) + Subnet mask (ปกติ
  `255.255.255.0`) + Gateway (ปกติ IP router เช่น `192.168.1.1`) — เช็ค subnet/gateway ที่ถูกต้อง
  ด้วย `ipconfig` ก่อน (ดูจาก IP ปัจจุบันที่ DHCP จ่ายให้)
- **DHCP reservation ที่ router:** ถ้ามีสิทธิ์ admin router ของสถานที่จัดงาน เข้าหน้าตั้งค่า router
  (ปกติ `192.168.1.1` หรือ `192.168.0.1`) หา DHCP reservation/Static Lease ผูก MAC address ของเครื่อง
  backend (เช็คด้วย `ipconfig /all` หา "Physical Address") เข้ากับ IP ที่ต้องการ — ข้อดีคือไม่ต้องยุ่ง
  กับ network adapter settings ของเครื่อง backend เลย ข้อเสียคือต้องมีสิทธิ์เข้า router ของสถานที่จัดงาน
  จริง (ถ้าเป็น wifi ที่คณะ/มหาลัยจัดให้ อาจขอสิทธิ์นี้ไม่ได้ — ใช้ static IP บนเครื่องเองปลอดภัยกว่า)

**1. HTTPS สำหรับ `getUserMedia`** — Chrome ถือว่า `http://` ปลอดภัยเฉพาะ `localhost`/`127.0.0.1`
เท่านั้น เปิดจาก `http://192.168.x.x` (LAN IP) จะขอสิทธิ์ไมค์ไม่ได้เลยแม้แต่ prompt ก็จะไม่มา

**ทางหลักสำหรับวันจริง: mkcert** (ไม่ใช่ `chrome://flags` — flag เป็น experimental setting ที่
Chrome อัปเดตอัตโนมัติแล้วรีเซ็ตทิ้งได้โดยไม่มีใครแตะโค้ดเลย เสี่ยงเกินไปสำหรับวันสอบ ส่วน root CA ของ
mkcert อยู่ใน trust store ของ Android เอง ไม่ขึ้นกับเวอร์ชัน Chrome เลย) — ใช้ IP ที่ล็อกไว้แล้วจาก
ขั้นตอนบน (cert ที่ mkcert ออกผูกกับ IP ที่ระบุตอนสร้างตายตัว เปลี่ยน IP ทีหลังต้องออก cert ใหม่)

ขั้นตอน (ทำครั้งเดียว ใช้เวลา ~20-30 นาที):

```bash
# 1. ติดตั้ง mkcert บนเครื่อง backend (Windows)
choco install mkcert
# หรือถ้าไม่มี choco: โหลด mkcert-vX.X.X-windows-amd64.exe จาก
# https://github.com/FiloSottile/mkcert/releases มาเปลี่ยนชื่อเป็น mkcert.exe

# 2. สร้าง root CA ในเครื่อง (ทำครั้งเดียว)
mkcert -install

# 3. ออก cert สำหรับ IP ที่ล็อกไว้แล้ว (เปลี่ยนเป็น IP จริงของเครื่อง backend)
mkcert 192.168.1.50 localhost 127.0.0.1
# ได้ไฟล์ 192.168.1.50+2.pem (cert) และ 192.168.1.50+2-key.pem (key) ในโฟลเดอร์ปัจจุบัน
```

**เอา cert ไปใช้กับ frontend:**
```bash
mkdir frontend-character/certs
cp 192.168.1.50+2.pem frontend-character/certs/cert.pem
cp 192.168.1.50+2-key.pem frontend-character/certs/key.pem
```
`vite.config.ts` เช็คไฟล์ 2 อันนี้เองอัตโนมัติ (ไม่มี = fallback เป็น http เงียบ ๆ ไม่กระทบ
`npm run dev` ตามปกติของทีมเลย) มีไฟล์แล้ว `npm run dev` จะยกเป็น `https://` ให้เอง

**เอา cert ไปใช้กับ backend (ต้องทำด้วย ไม่งั้นพังอยู่ดี):** หน้าเว็บที่เป็น `https://` เชื่อมต่อ
WebSocket แบบ `ws://` (ไม่เข้ารหัส) ไม่ได้ — เบราว์เซอร์บล็อกเป็น mixed content เสมอ ต้องให้ backend
เป็น `wss://` ด้วย วันจริงรัน backend แบบนี้แทน `docker compose up` (เพราะ mount cert เข้า container
ยุ่งกว่า รันตรงผ่าน venv ง่ายกว่ามาก):
```bash
docker compose up -d db      # ใช้แค่ db ผ่าน docker พอ
cd backend
.venv/Scripts/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 \
  --ssl-keyfile ../192.168.1.50+2-key.pem --ssl-certfile ../192.168.1.50+2.pem
```
`useVoiceSocket.ts` เดาสกีมจาก `location.protocol` ของหน้าเว็บเองอยู่แล้ว (หน้าเป็น https จะต่อ
`wss://` ให้อัตโนมัติ ไม่ต้องแก้อะไรเพิ่ม)

**ติดตั้ง root CA ลง Android (ทำครั้งเดียวต่อเครื่อง):**
1. หา root CA ที่ mkcert สร้างไว้: รัน `mkcert -CAROOT` บนเครื่อง backend จะได้ path (เช่น
   `C:\Users\...\AppData\Local\mkcert`) ไฟล์ที่ต้องการชื่อ `rootCA.pem`
2. ส่งไฟล์ `rootCA.pem` เข้าแท็บเล็ต (ไลน์/อีเมล/สาย USB ก็ได้ — ไฟล์ไม่ลับ เป็นแค่ root CA)
3. บนแท็บเล็ต: Settings > Security (หรือ "ความปลอดภัยและความเป็นส่วนตัว") > Encryption & credentials
   > Install a certificate > CA certificate > เลือกไฟล์ `rootCA.pem` ที่โอนมา > ยืนยัน (Android อาจ
   เตือนว่า "เครือข่ายอาจถูกตรวจสอบ" — ปกติ เป็นคำเตือนมาตรฐานเวลาเพิ่ม CA เอง ไม่ใช่ error)
4. ปิดเปิด Chrome ใหม่ แล้วเข้า `https://192.168.1.50:5174` ต้องไม่มีเตือนใบรับรองแล้ว (กุญแจล็อก
   ในแถบ URL)

**ทางสำรองเร็ว ๆ ระหว่าง dev (ไม่ใช้วันจริง):** `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
ยังใช้ได้ปกติสำหรับตอนพัฒนา/ทดสอบระหว่างวัน สะดวกกว่าเยอะไม่ต้องตั้ง cert — แค่**ห้ามพึ่งมันเป็นทางหลัก
ของวันสอบ**เพราะเหตุผลข้างบน

**ถ้าต่อสาย USB ได้:** เปิด USB debugging บนแท็บเล็ต ต่อสาย USB เข้าเครื่อง backend แล้วรัน
`adb reverse tcp:5174 tcp:5174` (และ `tcp:8000 tcp:8000`) — แท็บเล็ตจะเห็นเป็น `localhost` ตรง ๆ
(secure context อยู่แล้ว ไม่ต้องมี cert เลย) เหมาะถ้าตำแหน่งจริงวางเครื่อง backend ใกล้หุ่นยนต์พอจะ
เดินสาย USB ถึง — แต่เสี่ยงสายหลุดระหว่างเดโม ถ้าไม่แน่ใจว่าจะดูแลสายได้ตลอดงาน mkcert ทนกว่า

### เปิด Windows Firewall (จุดที่คาดว่าจะติดก่อนอย่างอื่น)

ค่า default ของ Windows บล็อก inbound connection จากเครื่องอื่นเข้าพอร์ตที่โปรแกรมเปิดไว้ ต้องเปิดเอง
2 พอร์ต (รันใน PowerShell **แบบ Run as Administrator**):

```powershell
New-NetFirewallRule -DisplayName "DITC CAT frontend (5174)" -Direction Inbound -Protocol TCP -LocalPort 5174 -Action Allow
New-NetFirewallRule -DisplayName "DITC CAT backend (8000)" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow
```

เช็คว่าเปิดสำเร็จจริง **ก่อนไปแก้เรื่องอื่น**: เปิดมือถือ/แท็บเล็ตเครื่องอื่น (ยังไม่ต้องเป็นตู้จริงก็ได้)
ต่อ wifi วงเดียวกัน แล้วเข้า `http://<LAN-IP เครื่อง backend>:8000/health` ผ่านเบราว์เซอร์ ต้องเห็น
`{"status":"ok",...}` — ถ้าเข้าไม่ได้เลย (timeout/connection refused) แปลว่า firewall ยังบล็อกอยู่
หรือรัน `New-NetFirewallRule` ไม่สำเร็จ (ต้อง Run as Administrator เท่านั้นถึงจะเพิ่ม rule ได้จริง)

**2. CORS / WebSocket ข้ามเครื่อง** — เช็คจาก source ของ Starlette ตรง ๆ แล้ว: `CORSMiddleware`
ข้าม request ที่ไม่ใช่ `"http"` scope ไปเลย (`if scope["type"] != "http": ปล่อยผ่าน`) แปลว่า
**WebSocket (`/api/voice/ws`) ไม่โดน CORS บล็อกอยู่แล้วไม่ว่าจะข้ามเครื่องแค่ไหน** ไม่ต้องแก้
`CORS_ORIGINS` เพื่อเรื่องนี้ (จะต้องแก้ก็ต่อเมื่อในอนาคตหน้านี้เรียก REST endpoint เช่น `/api/chat`
ข้าม origin ด้วย ซึ่งตอนนี้ยังไม่มี)

**3. ทดสอบบน Chrome Android จริง** — สิ่งที่แก้ไปแล้วในโค้ด (เจอจากการรีวิวก่อน ไม่ใช่แค่ทฤษฎี):
  - `vite.config.ts` เพิ่ม `host: true` — ค่า default ของ Vite bind แค่ `localhost` แท็บเล็ตเข้าไม่ถึง
    เลยถ้าไม่เปิดตรงนี้ (ต้องรันด้วย `npm run dev` ตามปกติ ไม่ต้องพิมพ์ `--host` เพิ่มเองแล้ว)
  - `useVoiceSocket.ts`: WS URL เดิม **hardcode `ws://localhost:8000` ซึ่งพังทันทีถ้าเปิดจากแท็บเล็ต**
    (`localhost` จากมุมมองแท็บเล็ตคือตัวแท็บเล็ตเอง ไม่ใช่เครื่อง backend) แก้เป็นเดาจาก
    `location.hostname` ของหน้านี้แทน (ครอบคลุมเคส "เครื่องเดียวรัน backend+frontend ทั้งคู่" ซึ่งเป็น
    setup ที่น่าจะใช้จริง) ถ้า backend อยู่คนละเครื่องจริง ๆ ตั้ง env var `VITE_VOICE_WS_URL` ตอนรัน
    `npm run dev` เช่น `VITE_VOICE_WS_URL=ws://192.168.1.50:8000/api/voice/ws npm run dev`
  - เพิ่ม `audioCtx.resume()` หลังสร้าง `AudioContext` — มือถือเข้มงวดเรื่อง autoplay กว่า desktop
    บางรุ่น แม้จะสร้างระหว่าง user gesture (คลิก "เริ่มคุย") ก็อาจเริ่มที่ state suspended ได้
  - **ทดสอบเองผ่าน automation ได้แค่ถึงจุดกดปุ่ม + เช็คไม่มี error ใน console** — สิทธิ์ไมค์บนมือถือ
    จริงต้องให้คนกดอนุญาตเองเสมอ ไม่มีทางทดสอบแทนได้ **ต้องเอาแท็บเล็ตจริงมาลองพูดดูเอง** (ดูหัวข้อ
    เปิด Windows Firewall ด้านล่าง — มักเป็นจุดที่ติดก่อนเรื่องอื่นเวลาทดสอบข้ามเครื่องครั้งแรก)

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
