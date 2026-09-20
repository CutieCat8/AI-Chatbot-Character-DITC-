import { Link } from "react-router";
import {
  ArrowRight,
  AudioLines,
  BarChart3,
  BookOpenCheck,
  Bot,
  Database,
  MessageCircle,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "../components/ui/button";
import logo from "../../assets/logo.png";

const CAPABILITIES = [
  {
    icon: AudioLines,
    number: "01",
    title: "สนทนาได้อย่างเป็นธรรมชาติ",
    description: "เปลี่ยนคำถามเกี่ยวกับ CAMT และ DITC ให้เป็นบทสนทนาที่เข้าใจง่าย พร้อมรองรับการโต้ตอบด้วยเสียง",
    className: "lg:col-span-7 bg-[#24201d] text-white",
    iconClassName: "bg-white/10 text-[#dccba9]",
  },
  {
    icon: BookOpenCheck,
    number: "02",
    title: "คำตอบจากข้อมูลที่ดูแลได้",
    description: "ค้นหาข้อมูลจาก Knowledge Base ก่อนตอบ และเปิดให้ทีมงานตรวจสอบ แก้ไข หรือปิดการใช้งานเอกสารได้",
    className: "lg:col-span-5 bg-[#e7dfd2] text-[#2d2925]",
    iconClassName: "bg-white/70 text-[#874526]",
  },
  {
    icon: BarChart3,
    number: "03",
    title: "เห็นภาพรวมจากทุกบทสนทนา",
    description: "ติดตามแนวโน้ม หัวข้อที่ถูกถาม และคุณภาพของข้อมูล เพื่อให้ทีมพัฒนาระบบต่อได้จากข้อมูลจริง",
    className: "lg:col-span-12 bg-white text-[#2d2925] border border-black/[0.06]",
    iconClassName: "bg-[#f1ede7] text-[#41342b]",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#f5f3ef] text-[#24211f] selection:bg-[#41342b] selection:text-white">
      <header className="sticky top-0 z-50 border-b border-black/[0.06] bg-[#f5f3ef]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[68px] max-w-7xl items-center justify-between px-5 sm:px-8 lg:px-10">
          <Link to="/" className="flex items-center gap-2.5" aria-label="DITC CAT home">
            <span className="flex size-8 items-center justify-center overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm">
              <img src={logo} alt="" className="size-full object-contain p-0.5" />
            </span>
            <span className="text-sm font-semibold tracking-[-0.02em]">DITC CAT</span>
          </Link>

          <nav className="hidden items-center gap-7 text-xs font-medium text-[#6c6762] md:flex">
            <a href="#overview" className="transition-colors hover:text-[#24211f]">ภาพรวม</a>
            <a href="#capabilities" className="transition-colors hover:text-[#24211f]">ความสามารถ</a>
            <a href="#about" className="transition-colors hover:text-[#24211f]">เกี่ยวกับระบบ</a>
          </nav>

          <Button asChild size="sm" className="rounded-full bg-[#24211f] px-4 text-white hover:bg-[#41342b]">
            <Link to="/login">
              เข้าสู่ระบบ
              <ArrowRight size={14} />
            </Link>
          </Button>
        </div>
      </header>

      <main>
        <section id="overview" className="relative overflow-hidden">
          <div className="pointer-events-none absolute -left-32 top-32 size-80 rounded-full bg-[#dccba9]/45 blur-[100px]" />
          <div className="pointer-events-none absolute right-0 top-0 size-96 rounded-full bg-[#c4763f]/10 blur-[120px]" />

          <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-5 pb-24 pt-16 sm:px-8 sm:pt-24 lg:grid-cols-[0.92fr_1.08fr] lg:px-10 lg:pb-32 lg:pt-28">
            <div>
              <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[#41342b]/15 bg-white/70 px-3 py-1.5 text-[11px] font-semibold tracking-[0.12em] text-[#5d5148] uppercase shadow-sm">
                <Sparkles size={12} />
                DITC Knowledge Assistant
              </div>

              <h1 className="max-w-2xl text-[2.65rem] font-semibold leading-[1.12] tracking-[-0.055em] text-[#211e1b] sm:text-6xl lg:text-[4.4rem]">
                ความรู้ของ DITC
                <span className="mt-1 block font-normal text-[#806f62]">ที่ถามได้ทุกเวลา</span>
              </h1>

              <p className="mt-7 max-w-xl text-[15px] leading-7 text-[#716b65] sm:text-base">
                ผู้ช่วยแมว AI ที่เชื่อมต่อบทสนทนากับฐานความรู้ของ CAMT และ DITC ช่วยให้ค้นหาคำตอบได้รวดเร็ว
                และช่วยให้ทีมงานดูแลข้อมูลทุกอย่างได้จากที่เดียว
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button asChild size="lg" className="h-12 rounded-full bg-[#24211f] px-6 text-white shadow-lg shadow-black/10 hover:bg-[#41342b]">
                  <Link to="/login">
                    เข้าสู่แดชบอร์ดผู้ดูแล
                    <ArrowRight size={16} />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="h-12 rounded-full border-black/10 bg-white/60 px-6 hover:bg-white">
                  <a href="#capabilities">ดูความสามารถของระบบ</a>
                </Button>
              </div>

              <div className="mt-12 flex flex-wrap gap-x-6 gap-y-3 text-xs text-[#736d67]">
                <span className="flex items-center gap-2"><ShieldCheck size={14} /> ควบคุมข้อมูลโดยทีมงาน</span>
                <span className="flex items-center gap-2"><Database size={14} /> ค้นหาจาก Knowledge Base</span>
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-[620px] lg:ml-auto">
              <div className="absolute -inset-5 -z-10 rounded-[40px] bg-gradient-to-br from-[#dccba9]/55 via-transparent to-[#874526]/15 blur-2xl" />
              <div
                className="relative min-h-[510px] overflow-hidden rounded-[32px] border border-white/10 bg-[#211e1c] p-5 text-white shadow-[0_32px_80px_-30px_rgba(53,39,29,0.55)] sm:p-7"
                style={{
                  backgroundImage:
                    "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
                  backgroundSize: "34px 34px",
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.14em] text-white/55 uppercase">
                    <span className="size-1.5 rounded-full bg-[#cbb663] shadow-[0_0_12px_#cbb663]" />
                    Knowledge online
                  </div>
                  <span className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[10px] text-white/55">DITC CAT · 01</span>
                </div>

                <div className="mt-14 flex justify-end">
                  <div className="max-w-[82%] rounded-[22px] rounded-br-md bg-white/10 px-4 py-3 text-sm leading-6 text-white/85 backdrop-blur">
                    ถ้าอยากดูข้อมูลหลักสูตรและบริการของ DITC ต้องเริ่มจากตรงไหน?
                  </div>
                </div>

                <div className="mt-4 rounded-[24px] rounded-tl-md bg-[#f7f5f1] p-5 text-[#2c2825] shadow-xl shadow-black/20">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-8 items-center justify-center overflow-hidden rounded-lg border border-black/10 bg-white">
                      <img src={logo} alt="" className="size-full object-contain p-0.5" />
                    </span>
                    <div>
                      <p className="text-xs font-semibold">DITC CAT</p>
                      <p className="text-[10px] text-[#8c847e]">ค้นจากฐานความรู้แล้ว</p>
                    </div>
                  </div>
                  <p className="mt-4 text-sm leading-6 text-[#57514c]">
                    เริ่มได้จากการเลือกหัวข้อที่สนใจ แล้วถามรายละเอียดเพิ่มเติมได้เลย ฉันจะค้นหาข้อมูลที่เกี่ยวข้องจากฐานความรู้ของระบบให้
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="rounded-full bg-[#e8e1d7] px-2.5 py-1 text-[10px] font-medium text-[#67584c]">หลักสูตร</span>
                    <span className="rounded-full bg-[#e8e1d7] px-2.5 py-1 text-[10px] font-medium text-[#67584c]">บริการ DITC</span>
                    <span className="rounded-full bg-[#e8e1d7] px-2.5 py-1 text-[10px] font-medium text-[#67584c]">ข้อมูลติดต่อ</span>
                  </div>
                </div>

                <div className="absolute inset-x-5 bottom-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/25 p-3 backdrop-blur-md sm:inset-x-7 sm:bottom-7">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#dccba9] text-[#332820]">
                    <AudioLines size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between text-[10px] text-white/45">
                      <span>พร้อมรับคำถามด้วยเสียง</span>
                      <span>TH</span>
                    </div>
                    <div className="mt-2 flex h-3 items-center gap-1">
                      {[5, 9, 6, 12, 8, 4, 10, 6, 8, 4, 7, 5].map((height, index) => (
                        <span key={index} className="w-1 rounded-full bg-white/35" style={{ height }} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="absolute -left-5 top-24 hidden items-center gap-2 rounded-xl border border-black/[0.06] bg-white/90 px-3 py-2.5 text-xs font-medium text-[#4e4843] shadow-xl backdrop-blur sm:flex">
                <Search size={14} className="text-[#874526]" /> Semantic search
              </div>
              <div className="absolute -right-4 bottom-28 hidden items-center gap-2 rounded-xl border border-black/[0.06] bg-white/90 px-3 py-2.5 text-xs font-medium text-[#4e4843] shadow-xl backdrop-blur sm:flex">
                <Bot size={14} className="text-[#874526]" /> Voice assistant
              </div>
            </div>
          </div>
        </section>

        <section id="capabilities" className="border-y border-black/[0.06] bg-[#eeebe5] py-24 sm:py-28">
          <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
            <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
              <div>
                <p className="text-[11px] font-semibold tracking-[0.16em] text-[#874526] uppercase">One connected system</p>
                <h2 className="mt-3 max-w-xl text-3xl font-semibold tracking-[-0.04em] text-[#27231f] sm:text-4xl">
                  จากคำถามหนึ่งประโยค<br />สู่ข้อมูลที่นำไปใช้ต่อได้
                </h2>
              </div>
              <p className="max-w-sm text-sm leading-6 text-[#746d66]">
                ออกแบบให้ผู้ใช้งานค้นคำตอบได้ง่าย และให้ผู้ดูแลเห็นสิ่งที่เกิดขึ้นเบื้องหลังอย่างครบถ้วน
              </p>
            </div>

            <div className="mt-12 grid gap-4 lg:grid-cols-12">
              {CAPABILITIES.map(({ icon: Icon, number, title, description, className, iconClassName }) => (
                <article key={number} className={`group relative min-h-[260px] overflow-hidden rounded-[26px] p-7 sm:p-8 ${className}`}>
                  <div className="flex items-start justify-between">
                    <span className={`flex size-11 items-center justify-center rounded-xl ${iconClassName}`}>
                      <Icon size={20} />
                    </span>
                    <span className="text-xs font-medium opacity-45">{number}</span>
                  </div>
                  <div className="mt-16 max-w-xl">
                    <h3 className="text-xl font-semibold tracking-[-0.025em]">{title}</h3>
                    <p className="mt-3 max-w-lg text-sm leading-6 opacity-65">{description}</p>
                  </div>
                  <div className="pointer-events-none absolute -bottom-20 -right-16 size-56 rounded-full border border-current opacity-[0.06] transition-transform duration-500 group-hover:scale-110" />
                  <div className="pointer-events-none absolute -bottom-11 -right-6 size-36 rounded-full border border-current opacity-[0.06] transition-transform duration-500 group-hover:scale-110" />
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="about" className="bg-[#f5f3ef] py-24 sm:py-32">
          <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
            <div className="relative overflow-hidden rounded-[32px] bg-[#41342b] px-6 py-14 text-white sm:px-12 sm:py-16 lg:px-16">
              <div className="pointer-events-none absolute -right-24 -top-32 size-96 rounded-full border border-white/10" />
              <div className="pointer-events-none absolute -right-8 -top-12 size-64 rounded-full border border-white/10" />
              <div className="relative grid gap-10 lg:grid-cols-[1fr_auto] lg:items-end">
                <div>
                  <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-[#dccba9] uppercase">
                    <MessageCircle size={13} />
                    DITC CAT Dashboard
                  </div>
                  <h2 className="mt-5 max-w-2xl text-3xl font-semibold leading-tight tracking-[-0.04em] sm:text-4xl">
                    จัดการความรู้และติดตามทุกบทสนทนาในพื้นที่เดียว
                  </h2>
                  <p className="mt-4 max-w-xl text-sm leading-6 text-white/60">
                    สำหรับทีมผู้ดูแลระบบ DITC CAT และผู้เกี่ยวข้องกับการพัฒนาฐานความรู้
                  </p>
                </div>
                <Button asChild size="lg" className="h-12 rounded-full bg-white px-6 text-[#2d2723] hover:bg-[#eee8de]">
                  <Link to="/login">
                    เข้าสู่ระบบผู้ดูแล
                    <ArrowRight size={16} />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-black/[0.06] bg-[#f5f3ef]">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-7 text-xs text-[#8a837c] sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10">
          <div className="flex items-center gap-2">
            <img src={logo} alt="" className="size-5 object-contain" />
            <span className="font-semibold text-[#4b4641]">DITC CAT</span>
          </div>
          <p>โปรเจกต์นักศึกษา คณะ CAMT มหาวิทยาลัยเชียงใหม่</p>
        </div>
      </footer>
    </div>
  );
}
