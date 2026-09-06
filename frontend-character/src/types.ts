// 5 สถานะตามดีไซน์ใน Scope (README เดิม): Idle / Transition / Web / Sleep / Wake
// แมปเป็น 7 render-state ของ CatFace.tsx (จาก Figma) ที่ App.tsx — ดูตารางแมปเต็มที่ CLAUDE.md
export type CatState = "idle" | "transition" | "web" | "sleep" | "wake";

export const CAT_STATES: readonly CatState[] = ["idle", "transition", "web", "sleep", "wake"];

export const CAT_STATE_LABELS: Record<CatState, string> = {
  idle: "Idle — ว่าง รอฟัง",
  transition: "Transition — เปลี่ยนสถานะ",
  web: "Web — กำลังค้นข้อมูล",
  sleep: "Sleep — เงียบนาน หลับ",
  wake: "Wake — เพิ่งได้ยินเสียงพูด",
};
