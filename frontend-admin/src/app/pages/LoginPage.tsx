import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Cat, Eye, EyeOff, ShieldCheck, X } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { login, setToken } from "../../lib/api";
import Orb from "../components/Orb/Orb";
import Aurora from "../components/Aurora/Aurora";

const TRUST_BADGES = [
  { label: "RAG พร้อมใช้งาน", className: "-top-3 left-1/2 -translate-x-1/2" },
  { label: "pgvector search", className: "top-1/2 -right-8 -translate-y-1/2" },
  { label: "PDPA compliant", className: "-bottom-3 -left-6" },
];

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await login(email, password);
      setToken(res.access_token);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "เข้าสู่ระบบไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-gray-950 px-4 py-8 overflow-hidden">
      <div className="absolute inset-0">
        <Aurora colorStops={["#8167ff", "#B497CF", "#261c4f"]} blend={0.5} amplitude={1.0} speed={0.5} />
      </div>

      <div className="relative z-10 w-full max-w-4xl bg-[#111214] border border-white/10 rounded-2xl shadow-2xl overflow-hidden grid md:grid-cols-2">
        <button
          onClick={() => navigate("/")}
          className="absolute top-4 right-4 z-20 text-gray-500 hover:text-gray-200 transition-colors"
          aria-label="ปิด"
        >
          <X size={18} />
        </button>

        {/* ฝั่งซ้าย: ฟอร์มล็อกอิน */}
        <div className="flex flex-col justify-between p-8 md:p-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-white flex items-center justify-center">
                <Cat size={14} className="text-gray-900" />
              </div>
              <span className="text-sm font-semibold text-white">DITC CAT</span>
            </div>
            <span className="text-xs text-gray-500">ติดปัญหา?</span>
          </div>

          <div className="mt-10">
            <h1 className="text-2xl font-semibold text-white">เข้าสู่ระบบ DITC CAT</h1>
            <p className="text-sm text-gray-400 mt-2">แดชบอร์ดเดียว จัดการ Knowledge Base และดูสถิติการสนทนา</p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-7">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email" className="text-gray-300">
                  อีเมล
                </Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@ditc.dev"
                  className="bg-white/5 border-white/10 text-white placeholder:text-gray-500"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-gray-300">
                    รหัสผ่าน
                  </Label>
                  <span className="text-xs text-gray-500">ลืมรหัสผ่าน?</span>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="กรอกรหัสผ่าน"
                    className="bg-white/5 border-white/10 text-white placeholder:text-gray-500 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                    aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}

              <Button
                type="submit"
                disabled={loading}
                className="w-full mt-1 bg-white text-gray-900 hover:bg-gray-200"
              >
                {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
              </Button>

              <p className="text-center text-xs text-gray-500">
                ยังไม่มีบัญชี?{" "}
                <Link to="/register" className="text-gray-200 hover:underline font-medium">
                  สมัครสมาชิก
                </Link>
              </p>
            </form>
          </div>

          <p className="flex items-center gap-1.5 text-xs text-gray-600 mt-10">
            <ShieldCheck size={13} />
            จำกัดการเข้าถึงเฉพาะทีมงาน DITC CAT
          </p>
        </div>

        {/* ฝั่งขวา: showcase วงแหวน + Orb */}
        <div className="relative hidden md:flex flex-col justify-between overflow-hidden bg-black">
          <div className="absolute inset-0 opacity-80">
            <Orb hoverIntensity={0.4} rotateOnHover={false} hue={200} forceHoverState={false} />
          </div>

          <div className="relative flex-1 flex items-center justify-center px-10">
            <div className="relative w-48 h-48">
              <div className="absolute inset-0 rounded-full border border-dashed border-white/15" />
              <div className="absolute inset-6 rounded-full border border-dashed border-white/15" />
              <div className="absolute inset-12 rounded-full border border-white/20" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center shadow-lg">
                  <Cat size={22} className="text-gray-900" />
                </div>
              </div>
              {TRUST_BADGES.map((badge) => (
                <span
                  key={badge.label}
                  className={`absolute ${badge.className} bg-black/70 border border-white/15 text-white text-[10px] px-2 py-1 rounded-full whitespace-nowrap backdrop-blur`}
                >
                  {badge.label}
                </span>
              ))}
            </div>
          </div>

          <div className="relative p-8 pt-0">
            <p className="text-white text-sm leading-relaxed">
              "ผู้ช่วยแมว AI ที่ตอบคำถาม CAMT / DITC ได้ตลอดเวลา จากฐานความรู้ที่อัปเดตจากเว็บจริง"
            </p>
            <p className="text-xs text-gray-500 mt-2">ทีมพัฒนา DITC CAT</p>
          </div>
        </div>
      </div>
    </div>
  );
}
