-- ============================================================
-- DITC CAT — DB init script (รันอัตโนมัติครั้งแรกที่ container db ถูกสร้าง)
-- เปิด extension ที่จำเป็นก่อนสร้างตาราง
-- ============================================================

-- pgvector: เก็บ embedding เพื่อทำ semantic search (RAG)
CREATE EXTENSION IF NOT EXISTS vector;

-- pg_trgm: ช่วย full-text / fuzzy search ภาษาไทยเบื้องต้น (เผื่อใช้เสริม)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
