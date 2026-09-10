import { useState, type ReactNode } from "react";
import "./HamburgerMenu.css";

interface Props {
  children: ReactNode;
}

/**
 * จอจริง (Galaxy Tab S10 FE+ หลังกระจกครอบ) ต้องเป็นหน้าแมวเต็มจอเสมอ ไม่มี UI อื่นให้เห็นเลย
 * (ดู CLAUDE.md) — เมนูนี้รวบฟังก์ชันทดสอบ/debug ทั้งหมดที่เคยเรียงอยู่ข้าง ๆ หน้าแมว (สลับโหมด,
 * ทดสอบด้วยไฟล์เสียง, พรีวิว Figma, คุยด้วยเสียงจริง) ไว้ในลิ้นชักเดียวมุมขวาบน เปิดเฉพาะตอนทีมพัฒนา/
 * เดโมต้องการเท่านั้น ปิดอยู่โดย default เพื่อไม่ให้บังหน้าแมว
 *
 * โครงหน้าตา (header ชื่อ+คำอธิบาย / เนื้อหา / footer ปุ่มปิด) ก็อปมาจากตัวอย่าง shadcn/ui
 * `DrawerNested` ที่ผู้ใช้ส่งมา (2026-09-10) — แต่เขียนด้วย plain CSS ล้วน ไม่ใช้ Tailwind/Base UI/
 * shadcn ของจริง เพราะโปรเจกต์นี้ไม่มี Tailwind ติดตั้งอยู่เลยตั้งแต่แรก (ดูคอมเมนต์ต้นไฟล์
 * CharacterPage.tsx) ขนาด/ตำแหน่ง/ทิศทางเลื่อน (จากขวา) เหมือนเดิมทุกประการ ไม่ได้ทำ swipe-to-close
 * ท่าทางลากจริง (ต้องพึ่ง gesture library) — ปิดได้ด้วยปุ่ม X, ปุ่ม "ปิด" ใน footer, หรือคลิก backdrop
 */
export function HamburgerMenu({ children }: Props) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      <button
        type="button"
        className="hamburger-button"
        aria-label={open ? "ปิดเมนู" : "เปิดเมนู"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={open ? "hamburger-line hamburger-line--top-open" : "hamburger-line"} />
        <span className={open ? "hamburger-line hamburger-line--mid-open" : "hamburger-line"} />
        <span className={open ? "hamburger-line hamburger-line--bot-open" : "hamburger-line"} />
      </button>

      {open && <div className="hamburger-backdrop" onClick={close} />}

      <aside className={`hamburger-drawer ${open ? "hamburger-drawer--open" : ""}`} aria-hidden={!open}>
        <header className="hamburger-drawer__header">
          <h2 className="hamburger-drawer__title">เมนูทดสอบ</h2>
          <p className="hamburger-drawer__description">
            สลับโหมดและเปิดแผงควบคุมสำหรับทีมพัฒนา/เดโม — จอจริงไม่มีเมนูนี้ให้เห็น
          </p>
        </header>

        <div className="hamburger-drawer__content">{children}</div>

        <footer className="hamburger-drawer__footer">
          <button type="button" className="hamburger-drawer__close-button" onClick={close}>
            ปิด
          </button>
        </footer>
      </aside>
    </>
  );
}
