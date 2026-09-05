import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// HTTPS แบบ opt-in ผ่าน mkcert — วางไฟล์ cert ที่ certs/cert.pem + certs/key.pem (mkcert สร้างให้
// ดูขั้นตอนใน README หัวข้อ "รันบนแท็บเล็ตจริงผ่าน LAN") ไม่มีไฟล์ = fallback เป็น http ปกติเงียบ ๆ
// ไม่กระทบ `npm run dev` ตามปกติของทีมเลย จำเป็นเฉพาะตอนทดสอบ getUserMedia บนแท็บเล็ตจริงผ่าน LAN
// (Chrome ถือ http://<LAN-IP> ว่าไม่ปลอดภัย ขอสิทธิ์ไมค์ไม่ได้ ต่างจาก localhost)
const certPath = path.resolve(dirname, "certs/cert.pem");
const keyPath = path.resolve(dirname, "certs/key.pem");
const hasCerts = fs.existsSync(certPath) && fs.existsSync(keyPath);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174, // frontend-admin ใช้ 5173 อยู่แล้ว กันชนกันตอนรันพร้อมกัน
    // host: true = bind 0.0.0.0 แทน localhost อย่างเดียว — จำเป็นสำหรับทดสอบบนแท็บเล็ตจริงผ่าน LAN
    // (ค่า default ของ Vite bind localhost เท่านั้น อุปกรณ์อื่นในวงแลนเข้าไม่ถึงเลยถ้าไม่เปิดตรงนี้)
    host: true,
    https: hasCerts ? { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) } : undefined,
  },
});
