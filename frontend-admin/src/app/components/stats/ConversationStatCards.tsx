import { useId, useState, type ReactNode } from "react";
import { MessageSquareText, HelpCircle, Tags, VolumeX, ArrowUpRight, ArrowDownRight, Info } from "lucide-react";
import type { ConversationStatsOut } from "../../../lib/api";
import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

interface ConversationStatCardsProps {
  stats: ConversationStatsOut;
  // null = โหลดช่วงก่อนหน้าไม่สำเร็จ หรือยังไม่มีค่า — การ์ดจะซ่อน delta แทนที่จะโชว์เลขมั่ว
  prevStats: ConversationStatsOut | null;
}

interface StatExplanation {
  summary: string;
  detail: string;
  note: string;
}

const STAT_EXPLANATIONS: Record<"unclassified" | "other" | "noise", StatExplanation> = {
  unclassified: {
    summary: "บทสนทนาจริงที่ยังไม่มีแท็กหัวข้อ",
    detail: "เกิดขึ้นขณะที่ AI กำลังจัดหมวด หรือเมื่อการจัดหมวดไม่สำเร็จ เช่น ระบบตอบกลับผิดรูปแบบหรือไม่มีแท็กที่ใช้งานได้",
    note: "ไม่รวมรายการเงียบ/ขยะ และตัวเลขอาจลดลงเมื่อการจัดหมวดเสร็จสมบูรณ์",
  },
  other: {
    summary: "จัดหมวดสำเร็จ แต่ไม่ตรงกับหัวข้อที่มีอยู่",
    detail: "ใช้กับคำถามจริงที่อยู่นอกชุดหัวข้อปัจจุบัน เพื่อช่วยให้ผู้ดูแลเห็นว่าควรเพิ่มหมวดใหม่หรือไม่",
    note: "หนึ่งบทสนทนาอาจมีแท็ก “อื่น ๆ” ร่วมกับหัวข้ออื่น แต่ช่องนี้นับบทสนทนานั้นเพียงหนึ่งครั้ง",
  },
  noise: {
    summary: "พบเสียงหรือการโต้ตอบ แต่ไม่พบสัญญาณคำถามจริง",
    detail: "ตัวอย่างเช่น เสียงรบกวน คนเดินผ่าน เสียงที่ระบบฟังไม่เข้าใจ หรือมีเพียงการทักทาย/คุยเล่นโดยไม่มีการค้นข้อมูลและไม่มีคำถามนอกขอบเขต",
    note: "ไม่นับรวมในจำนวนบทสนทนา กราฟแนวโน้มรายวัน และสถิติหัวข้อ",
  },
};

// unclassified/other ต้องเป็นตัวเลขที่เห็นง่าย (ผู้ว่าจ้างใช้ดูว่า enum ครอบพอไหม/classifier
// ทำงานปกติไหม) — ให้ขนาดตัวเลขเท่ากับการ์ดหลัก ไม่ใช่ตัวเล็กจิ๋วแบบรายละเอียดรอง
//
// การ์ดทั้ง 4 ใบใช้โทนเทาเดียวกันหมดโดยตั้งใจ (ไม่ใช้ amber/sky เด่นแยกเป็นบางใบ) — ผู้ว่าจ้าง
// feedback ว่าสีเหลือง/ฟ้าดันเด่นเกินไปจนดูเหมือนบางการ์ดสำคัญกว่าใบอื่น ทั้งที่ทั้ง 4 ตัวเลขนี้
// สำคัญเท่ากันหมดสำหรับดูสุขภาพของ classifier
export function ConversationStatCards({ stats, prevStats }: ConversationStatCardsProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
      <StatCard
        icon={<MessageSquareText size={15} />}
        label="จำนวนบทสนทนา"
        value={stats.total_conversations}
        prevValue={prevStats?.total_conversations}
        emphasis
      />
      <StatCard
        icon={<HelpCircle size={15} />}
        label="ยังไม่จัดหมวด"
        value={stats.unclassified_count}
        prevValue={prevStats?.unclassified_count}
        invertDelta
        explanation={STAT_EXPLANATIONS.unclassified}
      />
      <StatCard
        icon={<Tags size={15} />}
        label="อื่น ๆ"
        value={stats.other_count}
        prevValue={prevStats?.other_count}
        explanation={STAT_EXPLANATIONS.other}
      />
      <StatCard
        icon={<VolumeX size={15} />}
        label="เงียบ/ขยะ"
        value={stats.noise_count}
        prevValue={prevStats?.noise_count}
        invertDelta
        explanation={STAT_EXPLANATIONS.noise}
      />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  prevValue,
  explanation,
  emphasis = false,
  invertDelta = false,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  prevValue?: number;
  explanation?: StatExplanation;
  emphasis?: boolean;
  // เลขนี้ "น้อยลง = ดีขึ้น" ไหม (unclassified/noise ยิ่งน้อยยิ่งดี) — สลับสีขึ้น/ลงให้ตรงความหมายจริง
  // แทนที่จะยึดกฎ "ขึ้น=เขียวเสมอ" แบบตายตัวซึ่งจะหลอกตาให้ unclassified พุ่งขึ้นดูเหมือนเป็นเรื่องดี
  invertDelta?: boolean;
}) {
  let deltaPct: number | null = null;
  if (prevValue !== undefined && prevValue !== null) {
    if (prevValue === 0) {
      deltaPct = value > 0 ? 100 : null; // จาก 0 ขึ้นมา = คิดเป็น % ไม่ได้ตามหลัก ไม่โชว์ดีกว่าโชว์เลขหลอก
    } else {
      deltaPct = ((value - prevValue) / prevValue) * 100;
    }
  }

  const isUp = deltaPct !== null && deltaPct > 0;
  const isGood = deltaPct === null ? null : invertDelta ? !isUp : isUp;
  const deltaClass = isGood === null ? "text-gray-400" : isGood ? "text-emerald-600" : "text-red-500";

  return (
    <div
      className="group bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3 transition-shadow duration-300 ease-out hover:shadow-lg hover:border-gray-200"
    >
      <span className="w-8 h-8 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center shrink-0 transition-colors duration-300 ease-out group-hover:bg-gray-900 group-hover:text-white">
        {icon}
      </span>

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5 text-gray-500" style={{ fontSize: "0.78rem", fontWeight: 500 }}>
          <span>{label}</span>
          {explanation && <StatInfo label={label} explanation={explanation} />}
        </div>
        <p
          className="text-gray-900"
          style={{
            fontSize: emphasis ? "1.9rem" : "1.6rem",
            fontWeight: 700,
            letterSpacing: "-0.04em",
            lineHeight: 1,
          }}
        >
          {value.toLocaleString("th-TH")}
        </p>
      </div>

      {deltaPct !== null && (
        <span className={`flex items-center gap-1 ${deltaClass}`} style={{ fontSize: "0.7rem", fontWeight: 600 }}>
          {isUp ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
          {Math.abs(deltaPct).toFixed(1)}%
          <span className="text-gray-400" style={{ fontWeight: 400 }}>
            เทียบช่วงก่อนหน้า
          </span>
        </span>
      )}
    </div>
  );
}

function StatInfo({ label, explanation }: { label: string; explanation: StatExplanation }) {
  const [open, setOpen] = useState(false);
  const contentId = useId();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor className="inline-flex">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex size-5 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2"
              aria-label={`ดูคำอธิบาย ${label}`}
              aria-expanded={open}
              aria-controls={contentId}
              aria-haspopup="dialog"
              onClick={() => setOpen((current) => !current)}
              onPointerLeave={(event) => {
                if (event.pointerType !== "mouse") return;
                setOpen(false);
                event.currentTarget.blur();
              }}
            >
              <Info size={13} aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6} className="max-w-64 text-center leading-relaxed">
            {explanation.summary}
            <span className="mt-1 block text-[10px] opacity-70">คลิกเพื่อดูรายละเอียด</span>
          </TooltipContent>
        </Tooltip>
      </PopoverAnchor>

      <PopoverContent id={contentId} align="start" sideOffset={7} className="w-80 max-w-[calc(100vw-2rem)] p-0">
        <div className="border-b border-gray-100 px-4 py-3">
          <p className="text-sm font-semibold text-gray-900">{label}</p>
          <p className="mt-1 text-xs font-medium text-gray-600">{explanation.summary}</p>
        </div>
        <div className="space-y-2 px-4 py-3 text-xs leading-relaxed text-gray-600">
          <p>{explanation.detail}</p>
          <p className="rounded-md bg-gray-50 px-3 py-2 text-gray-500">{explanation.note}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
