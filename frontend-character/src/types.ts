// 4 สถานะตามสโคป TOR จริง: Idle / Transition / Sleep / Wake — ตัด "Web" ออกแล้ว (2026-09-07)
// "Web" เดิมตีความผิดว่าเป็นสถานะ "กำลังค้นข้อมูล" แต่ความหมายจริงใน TOR คือโหมดข่าววนตอนไม่มีคนใช้
// งาน ซึ่งไม่จำเป็นแล้วเพราะตู้มีกระจกครอบ ไม่มี touchscreen จอเหลือแค่หน้าแมวล้วน (ดู CLAUDE.md
// หัวข้อ "ข้อกำหนดที่ห้ามละเมิด" สำหรับรายละเอียดเต็มและสถานะการยืนยันกับที่ปรึกษาโครงงาน)
// แมปเป็น render-state ของ CatFace.tsx (จาก Figma) ที่ App.tsx — ดูตารางแมปเต็มที่ CLAUDE.md
export type CatState = "idle" | "transition" | "sleep" | "wake";

export const CAT_STATES: readonly CatState[] = ["idle", "transition", "sleep", "wake"];

export const CAT_STATE_LABELS: Record<CatState, string> = {
  idle: "Idle — ว่าง รอฟัง",
  transition: "Transition — เปลี่ยนสถานะ",
  sleep: "Sleep — เงียบนาน หลับ",
  wake: "Wake — เพิ่งได้ยินเสียงพูด",
};
