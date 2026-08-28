# วิธีรันโปรเจค (สำหรับพรีเซนต์)

Checklist รันโปรเจคจากศูนย์ หลังปิดคอมแล้วเปิดใหม่

## ก่อนเริ่ม

เปิด **Docker Desktop** ก่อน (ไอคอนวาฬที่ desktop/start menu) รอจนไอคอนบอกว่า "Docker Desktop is running" (สีเขียว) — ถ้าไม่เปิด Docker ก่อน คำสั่งข้างล่างจะ error ทันที

## Terminal ที่ 1 — Backend + Database

เปิด terminal (VS Code หรือ PowerShell ก็ได้) พิมพ์:

```bash
cd "C:\Users\Asus\Documents\AI-Chatbot-Character-DITC-"
docker compose up
```

**ไม่ต้องใส่ `--build`** (ใส่ต่อท้ายเฉพาะตอนแก้โค้ด backend เท่านั้น — image สร้างไว้แล้ว รันเฉยๆ เร็วกว่า)

รอจนเห็นบรรทัดนี้ขึ้นมาแปลว่าพร้อมแล้ว:

```
ditc_backend  | INFO:     Uvicorn running on http://0.0.0.0:8000
ditc_backend  | INFO:     Application startup complete.
```

**ปล่อย terminal นี้ทิ้งไว้แบบนี้ ห้ามปิด ห้ามกด Ctrl+C** (ต้องรันค้างไว้ตลอดเวลาที่ demo)

## Terminal ที่ 2 — Frontend

เปิด terminal ใหม่อีกอัน (แท็บใหม่ได้ ไม่ต้องปิดอันแรก) พิมพ์:

```bash
cd "C:\Users\Asus\Documents\AI-Chatbot-Character-DITC-\frontend-admin"
npm run dev
```

รอจนเห็น:

```
➜  Local:   http://localhost:5173/
```

**ปล่อยทิ้งไว้เหมือนกัน ห้ามปิด**

## เปิดเบราว์เซอร์

- หน้าแลนดิ้ง: **http://localhost:5173**
- หน้าล็อกอินแอดมิน: **http://localhost:5173/login**
- แดชบอร์ด (ต้องล็อกอินก่อน): **http://localhost:5173/dashboard**
- หน้าแชท demo (ต้องล็อกอินก่อน): **http://localhost:5173/dashboard/chat**

### สร้างบัญชีแอดมินสำหรับล็อกอิน (ทำครั้งแรกครั้งเดียว)

ยังไม่มีบัญชีแอดมินในระบบ ต้องสร้างเองก่อนถึงจะล็อกอินได้:

```bash
docker compose exec backend python -m app.scripts.create_admin admin@ditc.dev รหัสผ่านที่ตั้งเอง
```

(รันซ้ำด้วยอีเมลเดิม = รีเซ็ตรหัสผ่านให้)

## เช็คว่าทุกอย่างพร้อมก่อนพรีเซนต์จริง

1. เปิด **http://localhost:8000/health** → ต้องเห็น `"database": "connected"`
2. เปิด **http://localhost:5173** → การ์ดหมวดหมู่ต้องขึ้นตัวเลขจริง ไม่ค้างที่ `…`
3. เปิด **http://localhost:5173/chat** → ลองพิมพ์คำถามอะไรสักอย่าง เช่น "สาขา DII คืออะไร" ต้องได้คำตอบกลับมา (รอ ~10-30 วิ)

## ถ้ามีปัญหา

| อาการ | แก้ยังไง |
|---|---|
| `docker compose up` error ทันที ("Cannot connect to the Docker daemon") | Docker Desktop ยังไม่เปิด/ยังไม่พร้อม รอสักครู่แล้วลองใหม่ |
| Port ชนกัน ("port is already allocated") | มี container เก่าค้างอยู่ → `docker compose down` แล้วรัน `docker compose up` ใหม่ |
| หน้าเว็บขึ้น error เชื่อมต่อ API ไม่สำเร็จ | เช็คว่า terminal backend (ที่ 1) ยังรันอยู่ ไม่ error/ปิดไปหรือเปล่า |
| หน้าแชทไม่ตอบ/ค้าง | เช็ค terminal backend ว่ามี error สีแดงไหม (อาจเป็นปัญหา DeepSeek API key/เน็ต) |

## ปิดหลังพรีเซนต์เสร็จ (ไม่จำเป็น แต่ถ้าอยากปิดสะอาดๆ)

กด `Ctrl+C` ทั้ง 2 terminal แล้วพิมพ์ (terminal ไหนก็ได้):

```bash
docker compose down
```

ข้อมูลใน database ไม่หายเพราะเก็บอยู่ใน Docker volume แยกต่างหาก เปิดใหม่วันหลังข้อมูลยังอยู่ครบ

---

**สรุปสั้นๆ ที่ต้องจำ:** เปิด Docker Desktop → `docker compose up` (terminal 1) → `npm run dev` ใน `frontend-admin` (terminal 2) → เปิด `localhost:5173`
