import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174, // frontend-admin ใช้ 5173 อยู่แล้ว กันชนกันตอนรันพร้อมกัน
  },
});
