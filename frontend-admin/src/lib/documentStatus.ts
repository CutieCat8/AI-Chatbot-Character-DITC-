// สถานะที่โชว์บน UI มี 3 แบบ ไม่ใช่แค่ is_active/inactive ตรง ๆ (ผู้ว่าจ้างขอ 2026-09-20 หลังเจอเคส
// จริง: เพิ่มเอกสาร manual เนื้อหาสั้นเกินไป → ได้ 0 chunks → ขึ้น "Active" ทั้งที่เอาไปตอบไม่ได้เลย
// เพราะ retrieval.py ค้นจาก DocumentChunk เท่านั้น ไม่มี chunk ก็ไม่มีอะไรให้ค้นเจอ ต่อให้ is_active
// เป็น true — เพิ่มสถานะ "unindexed" แยกออกมา ให้ความสำคัญเหนือ is_active เสมอ (เอกสารจะ active/
// inactive อยู่ก็ตามแต่ถ้า 0 chunk คือ "ตอบไม่ได้" อยู่ดี ต้องรู้ก่อนสถานะอื่น)
export type DocumentDisplayStatus = "active" | "inactive" | "unindexed";

// ตรงกับ MIN_CHUNK ใน backend/app/rag/chunking.py — เนื้อหาสั้นกว่านี้ตัดเป็น chunk ไม่ได้เลยสักชิ้น
// ใช้เช็คฝั่ง UI ก่อนบันทึกด้วย (กันไม่ให้ตั้ง Active ทั้งที่รู้อยู่แล้วว่าเอาไปตอบไม่ได้แน่ ๆ)
export const MIN_CONTENT_LENGTH = 40;

interface DocumentStatusInput {
  is_active: boolean;
  chunk_count: number;
}

export function getDocumentStatus(doc: DocumentStatusInput): DocumentDisplayStatus {
  if (doc.chunk_count === 0) return "unindexed";
  return doc.is_active ? "active" : "inactive";
}

export const DOCUMENT_STATUS_STYLE: Record<
  DocumentDisplayStatus,
  { label: string; dotClass: string; textClass: string }
> = {
  active: { label: "Active", dotClass: "bg-emerald-500", textClass: "text-gray-500" },
  // เดิม inactive ใช้สีอำพันเหมือน unindexed เลยแยกไม่ออกว่า "แอดมินปิดเอง" กับ "เอาไปตอบไม่ได้จริง ๆ"
  // ต่างกันยังไง — inactive เปลี่ยนเป็นสีเทาเฉย ๆ (การตัดสินใจของแอดมิน ไม่ใช่ปัญหา) ส่วนอำพันเก็บไว้
  // ให้ unindexed อย่างเดียว (ปัญหาจริงที่ต้องตามแก้ เหมือนโทนสีที่ StatusPanel's Needs Attention ใช้)
  inactive: { label: "Inactive", dotClass: "bg-gray-300", textClass: "text-gray-400" },
  unindexed: { label: "Not Indexed", dotClass: "bg-amber-400", textClass: "text-amber-600" },
};
