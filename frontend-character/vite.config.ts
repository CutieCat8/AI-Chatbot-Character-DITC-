import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174, // frontend-admin ใช้ 5173 อยู่แล้ว กันชนกันตอนรันพร้อมกัน
    // host: true = bind 0.0.0.0 แทน localhost อย่างเดียว — จำเป็นสำหรับทดสอบบนแท็บเล็ตจริงผ่าน LAN
    // (ค่า default ของ Vite bind localhost เท่านั้น อุปกรณ์อื่นในวงแลนเข้าไม่ถึงเลยถ้าไม่เปิดตรงนี้)
    host: true,
  },
});
