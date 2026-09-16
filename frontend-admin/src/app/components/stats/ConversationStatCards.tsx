import type { ReactNode } from "react";
import { MessageSquareText, HelpCircle, Tags, VolumeX, ArrowUpRight, ArrowDownRight } from "lucide-react";
import type { ConversationStatsOut } from "../../../lib/api";

interface ConversationStatCardsProps {
  stats: ConversationStatsOut;
  // null = โหลดช่วงก่อนหน้าไม่สำเร็จ หรือยังไม่มีค่า — การ์ดจะซ่อน delta แทนที่จะโชว์เลขมั่ว
  prevStats: ConversationStatsOut | null;
}

// unclassified/other ต้องเป็นตัวเลขที่เห็นง่าย (ผู้ว่าจ้างใช้ดูว่า enum ครอบพอไหม/classifier
// ทำงานปกติไหม) — ให้ขนาดตัวเลขเท่ากับการ์ดหลัก ไม่ใช่ตัวเล็กจิ๋วแบบรายละเอียดรอง
export function ConversationStatCards({ stats, prevStats }: ConversationStatCardsProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
      <StatCard
        icon={<MessageSquareText size={13} className="text-gray-400" />}
        label="จำนวนบทสนทนา"
        value={stats.total_conversations}
        prevValue={prevStats?.total_conversations}
        emphasis
      />
      <StatCard
        icon={<HelpCircle size={13} className="text-amber-500" />}
        label="ยังไม่จัดหมวด (Unclassified)"
        value={stats.unclassified_count}
        prevValue={prevStats?.unclassified_count}
        tone="amber"
        invertDelta
        hint="classify ยังไม่จบ/ล้มเหลว หรือไม่มีสัญญาณให้จัดหมวดเลย"
      />
      <StatCard
        icon={<Tags size={13} className="text-sky-500" />}
        label="อื่น ๆ (Other)"
        value={stats.other_count}
        prevValue={prevStats?.other_count}
        tone="sky"
        hint="จัดหมวดสำเร็จ แต่ไม่ตรงกับหัวข้อที่มีอยู่ — enum อาจต้องเพิ่ม"
      />
      <StatCard
        icon={<VolumeX size={13} className="text-gray-400" />}
        label="เงียบ/ขยะ (Noise)"
        value={stats.noise_count}
        prevValue={prevStats?.noise_count}
        tone="gray"
        invertDelta
        hint="ไม่นับรวมในจำนวนบทสนทนา"
      />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  prevValue,
  hint,
  tone = "default",
  emphasis = false,
  invertDelta = false,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  prevValue?: number;
  hint?: string;
  tone?: "default" | "amber" | "sky" | "gray";
  emphasis?: boolean;
  // เลขนี้ "น้อยลง = ดีขึ้น" ไหม (unclassified/noise ยิ่งน้อยยิ่งดี) — สลับสีขึ้น/ลงให้ตรงความหมายจริง
  // แทนที่จะยึดกฎ "ขึ้น=เขียวเสมอ" แบบตายตัวซึ่งจะหลอกตาให้ unclassified พุ่งขึ้นดูเหมือนเป็นเรื่องดี
  invertDelta?: boolean;
}) {
  const valueColor =
    tone === "amber" ? "text-amber-700" : tone === "sky" ? "text-sky-700" : "text-gray-900";
  const border = tone === "amber" ? "border-amber-100" : tone === "sky" ? "border-sky-100" : "border-gray-100";

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
    <div className={`bg-white rounded-xl border ${border} shadow-sm p-4 flex flex-col gap-2.5`}>
      <span className="text-gray-700 flex items-center gap-1.5" style={{ fontSize: "0.78rem", fontWeight: 600 }} title={hint}>
        {icon}
        {label}
      </span>
      <p
        className={valueColor}
        style={{
          fontSize: emphasis ? "1.9rem" : "1.6rem",
          fontWeight: 700,
          letterSpacing: "-0.04em",
          lineHeight: 1,
        }}
      >
        {value.toLocaleString("th-TH")}
      </p>
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
