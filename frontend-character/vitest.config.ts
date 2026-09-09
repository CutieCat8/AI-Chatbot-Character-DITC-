import { defineConfig } from "vitest/config";

// แยกจาก vite.config.ts (คุม dev server จริง ไม่อยากให้ config เทสไปแตะ) — เทสต้องใช้ jsdom
// เพราะ useVoiceSocket.ts อ่าน `location`/`window` ระดับ module (ดูคอมเมนต์ WS_URL ในไฟล์นั้น)
export default defineConfig({
  test: {
    environment: "jsdom",
  },
});
