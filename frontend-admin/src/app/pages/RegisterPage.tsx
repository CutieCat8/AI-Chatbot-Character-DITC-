import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Cat } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { register, setToken } from "../../lib/api";

export default function RegisterPage() {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await register(email, password, displayName);
      setToken(res.access_token);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "สมัครสมาชิกไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-2 mb-8">
          <div className="w-10 h-10 rounded-xl bg-gray-900 flex items-center justify-center">
            <Cat size={20} className="text-white" />
          </div>
          <h1 className="text-lg font-semibold text-gray-900">สมัครบัญชีแอดมิน</h1>
          <p className="text-sm text-gray-400">DITC CAT — แดชบอร์ดจัดการระบบ</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white border border-gray-100 rounded-xl p-6 flex flex-col gap-4 shadow-sm">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="displayName">ชื่อที่แสดง</Label>
            <Input
              id="displayName"
              type="text"
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="ทีมงาน"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">อีเมล</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@ditc.dev"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">รหัสผ่าน</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="อย่างน้อย 8 ตัวอักษร"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <Button type="submit" disabled={loading} className="w-full mt-2">
            {loading ? "กำลังสมัคร..." : "สมัครสมาชิก"}
          </Button>

          <p className="text-center text-xs text-gray-400">
            มีบัญชีอยู่แล้ว?{" "}
            <Link to="/login" className="text-gray-700 hover:underline font-medium">
              เข้าสู่ระบบ
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
