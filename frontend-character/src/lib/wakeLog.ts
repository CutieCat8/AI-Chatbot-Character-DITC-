/**
 * Log กลาง เก็บ timeline เหตุการณ์ของ flow "ปลุกด้วยเสียง -> ปล่อยไมค์ -> connect()" ไว้ debug บั๊ก
 * แย่งไมค์ (ดู useWakeWord.ts, useVoiceSocket.ts) — เจ้าของงานต้องทดสอบซ้ำ 5-6 รอบแล้วบอกได้แค่
 * "บางทีติดบางทีไม่ติด" จากปากเปล่า ไม่พอให้วินิจฉัย ต้องมี timestamp จริงของแต่ละ event เทียบกันได้
 * `window.__wakeLog()` ก๊อป log ทั้งหมดออกมารอบเดียว (เรียกจาก console ได้ตรงๆ ไม่ต้องพึ่ง overlay)
 */
export interface WakeLogEntry {
  t: number; // performance.now() ms ตอน log
  event: string;
  detail?: string;
}

const MAX_ENTRIES = 300;
const buffer: WakeLogEntry[] = [];

export function logWake(event: string, detail?: string): void {
  buffer.push({ t: performance.now(), event, detail });
  if (buffer.length > MAX_ENTRIES) buffer.shift();
}

export function formatWakeLog(): string {
  if (buffer.length === 0) return "(ยังไม่มี log)";
  const t0 = buffer[0].t;
  return buffer
    .map((e) => `+${(e.t - t0).toFixed(1)}ms  ${e.event}${e.detail ? "  — " + e.detail : ""}`)
    .join("\n");
}

export function getWakeLog(): WakeLogEntry[] {
  return [...buffer];
}

export function clearWakeLog(): void {
  buffer.length = 0;
}

declare global {
  interface Window {
    __wakeLog?: () => string;
  }
}

// module scope ไม่ใช่ useEffect — แค่ import ไฟล์นี้ (จาก useWakeWord.ts/useVoiceSocket.ts ที่เรียก
// logWake) window.__wakeLog ก็พร้อมใช้ทันทีโดยไม่ต้องรอ component ไหน mount
if (typeof window !== "undefined") {
  window.__wakeLog = () => {
    const text = formatWakeLog();
    console.log(text);
    return text;
  };
}
