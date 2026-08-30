import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Cat, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { login, setToken } from "../../lib/api";
import { AuthShowcase } from "../components/AuthShowcase";
import Aurora from "../components/Aurora/Aurora";

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
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="relative min-h-screen flex items-center justify-center bg-gray-950 px-4 py-10 overflow-hidden"
      style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
    >
      <div className="absolute inset-0">
        <Aurora colorStops={["#8167ff", "#B497CF", "#261c4f"]} blend={0.5} amplitude={1.0} speed={0.5} />
      </div>

      <div className="relative z-10 w-full max-w-4xl min-h-[640px] bg-[#111214] border border-white/10 rounded-2xl shadow-2xl overflow-hidden grid md:grid-cols-2">
        {/* Left: sign-in form */}
        <div className="flex flex-col justify-between p-10 md:p-14 bg-[#161719]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-white flex items-center justify-center">
                <Cat size={14} className="text-gray-900" />
              </div>
              <span className="text-sm font-semibold text-white">DITC CAT</span>
            </div>
            <span className="text-xs text-gray-500">Need help?</span>
          </div>

          <div className="mt-14 px-4">
            <h1 className="text-2xl font-semibold text-white [word-spacing:0.2em]">Sign in to DITC CAT</h1>
            <p className="text-xs text-gray-400 mt-2.5">One dashboard for the knowledge base and conversation analytics.</p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-5 mt-9">
              <div className="flex flex-col gap-2.5">
                <Label htmlFor="email" className="text-gray-300">
                  Work email
                </Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@ditc.dev"
                  className="bg-black/40 border-white/25 text-white placeholder:text-gray-500 rounded-xl"
                />
              </div>

              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-gray-300">
                    Password
                  </Label>
                  <span className="text-xs text-gray-500">Forgot password?</span>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="bg-black/40 border-white/25 text-white placeholder:text-gray-500 pr-10 rounded-xl"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                    aria-label={showPassword ? "Hide password" : "Show password"}
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
                {loading ? "Signing in..." : "Sign in"}
              </Button>

              <p className="text-center text-xs text-gray-500">
                New to DITC CAT?{" "}
                <Link to="/register" className="text-gray-200 hover:underline font-medium">
                  Create an account
                </Link>
              </p>
            </form>
          </div>

          <p className="flex items-center gap-1.5 text-xs text-gray-600 mt-14">
            <ShieldCheck size={13} />
            Restricted to the DITC CAT team.
          </p>
        </div>

        <AuthShowcase />
      </div>
    </div>
  );
}
