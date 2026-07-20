# DITC CAT

ระบบ **AI Chatbot Character** บนแท็บเล็ต สำหรับหุ่นยนต์ของศูนย์ DITC คณะ CAMT มหาวิทยาลัยเชียงใหม่
โต้ตอบด้วย **เสียงล้วน** (หน้าจอมีกระจกกัน แตะไม่ได้) ตอบคำถามเฉพาะเรื่อง **CAMT / DITC** ด้วยสถาปัตยกรรม **RAG**
พร้อม Character แมวที่มีแอนิเมชันปากขยับตามเสียง (lip-sync) และอารมณ์ประกอบ

> ขอบเขตงานนี้ครอบคลุมเฉพาะ **ซอฟต์แวร์** (ไม่รวมกลไก/มอเตอร์ของหุ่นยนต์)

---

## สถาปัตยกรรม (4 โมดูล)

| โมดูล | หน้าที่ |
|---|---|
| **Voice Pipeline** | Wake-word "สวัสดีดิตซีแคท" → STT → RAG/LLM → TTS + lip-sync data |
| **RAG + Knowledge Base** | Scrape เว็บ → vector DB → semantic search → guardrail → fallback |
| **Character Display** | หน้าแมว 5 สถานะ (Idle/Transition/Web/Sleep/Wake) + lip-sync + อารมณ์ |
| **Admin Dashboard** | login, จัดการ KB, สถิติ, สรุปฟีดแบค, ตั้งค่า Idle |

## Tech Stack

- **Backend:** FastAPI (Python 3.13) + SQLAlchemy 2.0 + Alembic
- **Database:** PostgreSQL 16 + **pgvector** (semantic search)
- **Frontend:** React / Next.js + Rive/Lottie
- **Auth:** JWT
- **Infra:** Docker Compose
- **AI:** LLM (Claude/GPT — ยังเลือกได้), Embedding, STT/TTS (Google/Azure)

---

## โครงสร้าง Monorepo

```
AI-Chatbot-Character-DITC-/
├── docker-compose.yml        # รันทั้งระบบด้วยคำสั่งเดียว
├── .env.example              # ตัวอย่าง config (คัดลอกเป็น .env)
├── db/init/                  # SQL เปิด extension (pgvector) ตอนสร้าง DB
├── backend/                  # FastAPI + RAG + models
│   ├── app/
│   │   ├── main.py           # จุดเริ่ม API (/ , /health)
│   │   ├── config.py         # โหลด setting จาก .env
│   │   ├── database.py       # เชื่อม DB (engine, session, Base)
│   │   ├── models/           # ตารางฐานข้อมูล (T02)
│   │   └── scraper/          # ดึงเนื้อหาเว็บ DITC/CAMT เข้า KB (T03)
│   └── alembic/              # migration ฐานข้อมูล
├── frontend-character/       # หน้าจอแมว (Sprint 3)
└── frontend-admin/           # เว็บแอดมิน + แดชบอร์ด (Sprint 4)
```

---

## เริ่มต้นใช้งาน (Development)

### วิธีที่ 1 — Docker (แนะนำ) ต้องติดตั้ง [Docker Desktop](https://www.docker.com/products/docker-desktop/) ก่อน

```bash
# 1. เตรียม env
cp .env.example .env          # แล้วแก้ค่า secret ตามจริง

# 2. รันทั้งระบบ (db + backend)
docker compose up --build

# 3. เปิดใช้งาน
#    API docs : http://localhost:8000/docs
#    Health   : http://localhost:8000/health
```

สร้าง/อัปเดตตารางในฐานข้อมูล (หลัง db ขึ้นแล้ว):

```bash
# สร้าง migration แรกจาก models (autogenerate)
docker compose exec backend alembic revision --autogenerate -m "initial schema"
# นำ migration ไปใช้กับ DB
docker compose exec backend alembic upgrade head
```

### วิธีที่ 2 — รัน backend แบบ local (ยังไม่มี Docker)

ต้องมี PostgreSQL + pgvector ของตัวเอง แล้วตั้ง `POSTGRES_HOST=localhost` ใน `.env`

```bash
cd backend
python -m venv .venv
source .venv/Scripts/activate      # Windows (Git Bash) — Linux/Mac ใช้ .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

---

## Database Schema (T02)

| ตาราง | หน้าที่ | หมายเหตุ |
|---|---|---|
| `documents` | เนื้อหาที่ scrape มา / แอดมินเพิ่ม | Knowledge Base ต้นทาง |
| `document_chunks` | ชิ้นเนื้อหา + **embedding (vector)** | หัวใจ RAG (HNSW index, cosine) |
| `conversation_sessions` | สรุปหัวข้อ + สถิติบทสนทนา | **PDPA: ไม่เก็บบทสนทนาดิบ** |
| `feedbacks` | สรุปฟีดแบค + หมวด + sentiment | **PDPA: ไม่เก็บเสียง/ข้อความดิบ** |
| `idle_contents` | ข่าว/ประกาศวนจอ Idle/Sleep | แอดมิน toggle ซ่อนได้ |
| `admin_users` | ผู้ดูแลระบบ (login) | เก็บ hashed password |

>  **PDPA:** ตาราง session/feedback เก็บแค่ "หัวข้อสรุปจาก AI + วันเวลา" ตาม Scope ข้อ 7–8

---

## Web Scraper (T03)

ดึงเนื้อหาเข้า Knowledge Base จาก **2 แหล่ง** (Scope 3.1) — แต่ละเว็บสถาปัตยกรรมต่างกัน จึงใช้คนละวิธี:

| แหล่ง | สภาพเว็บ | วิธีดึง |
|---|---|---|
| **camt.cmu.ac.th** | server-rendered (WordPress) | **HTML scraper** (crawl ตามลิงก์ในโดเมน) — ใช้ `www.` เพราะ apex domain ใบ SSL ไม่ตรงชื่อ |
| **ditc.camt.cmu.ac.th** | Next.js SPA (เนื้อหาโหลดด้วย JS) | **Strapi API client** — ดึง JSON ตรงจาก CMS (`infos`=ข่าว, `projects`, `facilities`) |

> ⚠️ Strapi endpoint ของ DITC เป็น **internal API** (สังเกตจาก network request ไม่ใช่ API ทางการ)
> โครงสร้างอาจเปลี่ยนได้ — โค้ดจึง handle error แยกต่อ collection (พังทีละอันได้ ไม่ล้มทั้งระบบ)

```bash
cd backend

# ดึงทั้งสองแหล่ง → dump เป็น JSON (ทดสอบได้แม้ยังไม่มี DB)
python -m app.scraper.run --json data/scrape.json

# ดึง → dump JSON + บันทึกลงตาราง documents พร้อมกัน (ต้องมี DB + รัน migration แล้ว)
python -m app.scraper.run --json data/scrape.json --to-db

# ดึงเฉพาะแหล่งเดียว
python -m app.scraper.run --only strapi --json data/ditc.json   # เฉพาะ DITC
python -m app.scraper.run --only html   --json data/camt.json   # เฉพาะ CAMT
```

การ upsert ใช้ `content_hash` (Scope 3.2): url ใหม่ = เพิ่ม, hash เปลี่ยน = อัปเดต+ล้าง chunk เดิม, hash เท่าเดิม = ข้าม

---

## แผนงาน (5 Sprint / 45 tasks / 40[+5] วัน)

| Sprint | ธีม | สถานะ |
|---|---|---|
| 1 | Setup + Foundation | 🔨 กำลังทำ (T01 Done \| T02 Done \| T03 Done) |
| 2 | Core RAG + Voice Pipeline | Pending |
| 3 | Character UI + Lip-sync | Pending |
| 4 | Admin Dashboard + Feedback | Pending |
| 5 | Integration, Testing & Delivery | Pending |
