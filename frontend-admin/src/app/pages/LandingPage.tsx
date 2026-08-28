import { Link } from "react-router";
import { Cat, MessageCircle, Database, ShieldCheck } from "lucide-react";
import { Button } from "../components/ui/button";

const FEATURES = [
  {
    icon: MessageCircle,
    title: "ตอบคำถามด้วยเสียง",
    desc: "ผู้ใช้พูดคุยกับแมว AI ถามเรื่อง CAMT / DITC ได้ตลอดเวลา",
  },
  {
    icon: Database,
    title: "Knowledge Base อัปเดตอัตโนมัติ",
    desc: "ดึงเนื้อหาจากเว็บ CAMT และ DITC เข้าระบบ ค้นหาด้วย semantic search",
  },
  {
    icon: ShieldCheck,
    title: "จัดการโดยแอดมิน",
    desc: "แก้ไข Knowledge Base ดูสถิติการสนทนา และสรุปฟีดแบคได้จากแดชบอร์ดเดียว",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="h-14 flex items-center justify-between px-8 border-b border-gray-100 bg-white">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-gray-900 flex items-center justify-center">
            <Cat size={14} className="text-white" />
          </div>
          <span className="text-sm font-semibold text-gray-900 tracking-tight">DITC CAT</span>
        </div>
        <Link to="/login">
          <Button size="sm">เข้าสู่ระบบแอดมิน</Button>
        </Link>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-20 text-center">
        <div className="w-16 h-16 rounded-2xl bg-gray-900 flex items-center justify-center mb-6">
          <Cat size={32} className="text-white" />
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold text-gray-900 max-w-2xl leading-tight">
          ผู้ช่วยแมว AI ประจำศูนย์ DITC
        </h1>
        <p className="text-gray-500 max-w-lg mt-4 text-sm md:text-base">
          ตอบคำถามเกี่ยวกับ CAMT และ DITC ด้วยเสียงล้วน ขับเคลื่อนด้วย RAG และฐานความรู้ที่อัปเดตจากเว็บจริง
        </p>
        <div className="flex items-center gap-3 mt-8">
          <Link to="/login">
            <Button size="lg">เข้าสู่ระบบแอดมิน</Button>
          </Link>
        </div>

        <div className="grid sm:grid-cols-3 gap-4 mt-20 max-w-4xl w-full">
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="bg-white border border-gray-100 rounded-xl p-5 text-left">
              <Icon size={18} className="text-gray-700 mb-3" />
              <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
              <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="text-center text-xs text-gray-400 pb-6">
        โปรเจกต์นักศึกษา คณะ CAMT มหาวิทยาลัยเชียงใหม่
      </footer>
    </div>
  );
}
