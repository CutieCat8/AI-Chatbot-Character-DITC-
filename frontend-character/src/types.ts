// 5 สถานะตามดีไซน์ใน Scope (README เดิม): Idle / Transition / Web / Sleep / Wake
// ดูรายละเอียดพฤติกรรมแต่ละสถานะที่ CatCharacter.tsx (คอมเมนต์กำกับแต่ละสถานะไว้ที่จุดใช้งาน)
export type CatState = "idle" | "transition" | "web" | "sleep" | "wake";

export const CAT_STATES: readonly CatState[] = ["idle", "transition", "web", "sleep", "wake"];

export const CAT_STATE_LABELS: Record<CatState, string> = {
  idle: "Idle — ว่าง รอฟัง",
  transition: "Transition — เปลี่ยนสถานะ",
  web: "Web — กำลังค้นข้อมูล",
  sleep: "Sleep — เงียบนาน หลับ",
  wake: "Wake — เพิ่งได้ยินเสียงพูด",
};
