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
- **AI:** LLM (Claude/DeepSeek — เลือกผ่าน `LLM_PROVIDER`), Embedding (`intfloat/multilingual-e5-large`, local ฟรี), Voice (Gemini Live API)

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
│   │   ├── scraper/          # ดึงเนื้อหาเว็บ DITC/CAMT เข้า KB (T03)
│   │   └── rag/              # embedding + vector search (pgvector) (T04)
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

> Strapi endpoint ของ DITC เป็น **internal API** (สังเกตจาก network request ไม่ใช่ API ทางการ)
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

## Vector Database — embedding + retrieval (T04)

วาง "ฐาน" ของ semantic search: `documents` (เนื้อหาดิบ) → **chunk** → **embed** → `document_chunks` (เวกเตอร์)
แล้วค้นด้วย **cosine distance** ของ pgvector (RAG pipeline เต็มตอนตอบคำถาม = T10 ใน Sprint 2)

| ไฟล์ | หน้าที่ |
|---|---|
| `rag/embedding.py` | แปลงข้อความ→เวกเตอร์ สลับ provider ได้: `e5` (จริง, local ฟรี, ค่าเริ่มต้น) \| `openai` \| `fake` (ทดสอบ ไม่ต้องมี key) |
| `rag/chunking.py` | ตัดเอกสารเป็นชิ้น (char-window + overlap รองรับภาษาไทยที่ไม่มีเว้นวรรค) |
| `rag/indexer.py` | chunk+embed เอกสาร → เก็บ `document_chunks` (ข้ามอันที่ index แล้ว) |
| `rag/retrieval.py` | ค้น chunk ใกล้เคียงคำถามด้วย pgvector (`<=>`, HNSW index จาก T02) |
| `rag/verify.py` | สคริปต์พิสูจน์ครบวงจร (ดีลิเวอรี T04) |

```bash
# หลัง docker compose up + alembic upgrade head แล้ว:
cd backend

# พิสูจน์ทั้งระบบ (เช็ก pgvector → index → ค้นตัวอย่าง)
python -m app.rag.verify

# ยังไม่ได้ scrape จริง? ใส่ข้อมูลตัวอย่างก่อนได้
python -m app.rag.verify --seed-demo

# ลองค้นคำถามเอง
python -m app.rag.verify --query "ค่าเทอมหลักสูตร SE เท่าไหร่"
```

> ทดสอบ "ท่อ" โดยไม่ต้องมี key ได้ด้วย `EMBEDDING_PROVIDER=fake` ใน `.env`
> (fake = เวกเตอร์จำลอง พิสูจน์ว่า pipeline ทำงาน แต่ไม่มีความหมายเชิงภาษา — ค่าเริ่มต้นจริงคือ `e5`)
> เลือกใช้ `intfloat/multilingual-e5-large` แทน OpenAI/BGE-M3 หลัง benchmark เทียบกัน — เหตุผลเต็มดูที่
> [`docs/adr/embedding-model.md`](docs/adr/embedding-model.md)

---

## Voice Pipeline (Sprint 2) — Gemini Live API

โต้ตอบด้วยเสียงจริงผ่าน [Gemini Live API](https://ai.google.dev/gemini-api/docs/live) (ไม่ได้ต่อ STT/TTS
แยกชิ้นเอง) — โมเดล `gemini-3.1-flash-live-preview` พูดไทยลื่น รองรับ function calling เข้า `rag/retrieval.py`
เดิมได้ตรง ๆ ระหว่างคุย (ค้นฐานความรู้แล้วตอบจากผลจริงเท่านั้น ไม่เดา)

| ไฟล์ | หน้าที่ |
|---|---|
| `app/routers/voice.py` | WS bridge (`/api/voice/ws`) — เสียงจากเบราว์เซอร์ ↔ Gemini Live ↔ เสียงตอบ (ให้ browser ทำ VAD/buffer เอง) |
| `app/scripts/voice_pipeline_dev.py` | วงจรเสียงเต็มรูปแบบบนเครื่อง dev (ไมค์+ลำโพงจริง ไม่ต้องมี frontend) — ไว้ทดสอบวงจรทั้งวงก่อนต่อ `frontend-character` |
| `app/static/voice_test.html` | หน้าทดสอบ WS bridge ผ่านเบราว์เซอร์ (เปิดที่ `/voice-test`) |

```bash
cd backend
.venv/Scripts/python -m app.scripts.voice_pipeline_dev   # พูดใส่ไมค์ได้เลย ไม่ต้องกดปุ่ม
```

**ดีไซน์สำคัญ: half-duplex โดยตั้งใจ** — ไมค์จะปิดสนิทระหว่างแมวกำลังพูด เปิดฟังใหม่ทันทีที่พูดจบ
(ไม่รองรับพูดแทรกกลางคำตอบ) เพราะเครื่อง dev ไม่มี hardware AEC ทดสอบจริงพบว่าเสียงลำโพงหลุดเข้าไมค์
โดน Gemini ตีความเป็นผู้ใช้พูดแทรกซ้ำ ๆ ตัดคำตอบกลางคันทุกครั้ง (ยืนยันด้วยหูฟัง: ใส่แล้วปัญหาหายสนิท)
และปัญหาคลาสเดียวกันจะเกิดจากเสียงคนคุยกันรอบข้างหน้าบูธจริงด้วย — ตัดสินใจร่วมกับทีมว่า mute ไมค์
ระหว่างพูดปลอดภัยกว่าจริงในสภาพแวดล้อมที่มีเสียงดัง (คำตอบสั้นอยู่แล้ว 1-3 ประโยค ต้นทุนรอต่ำ) รายละเอียด
เต็มอยู่ในคอมเมนต์บนสุดของ `voice_pipeline_dev.py`

---

## แผนงาน (5 Sprint / 45 tasks / 40[+5] วัน)

| Sprint | ธีม | สถานะ |
|---|---|---|
| 1 | Setup + Foundation | Done (T01 \| T02 \| T03 \| T04) |
| 2 | Core RAG + Voice Pipeline | WIP — chat backend + retrieval fixes Done, embedding เปลี่ยนเป็น e5-large Done, Gemini Live voice pipeline Done (dev-machine), ยังไม่ทดสอบ STT เสียงคนจริง |
| 3 | Character UI + Lip-sync | Pending (`frontend-character/` ยังเป็นแค่ README) |
| 4 | Admin Dashboard + Feedback | WIP — login/register + knowledge base dashboard + chat demo Done |
| 5 | Integration, Testing & Delivery | Pending |
