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
        hint="classify ยังไม่จบ/ล้มเหลว หรือไม่มีสัญญาณให้จัดหมวดเลย"
      />
      <StatCard
        icon={<Tags size={15} />}
        label="อื่น ๆ"
        value={stats.other_count}
        prevValue={prevStats?.other_count}
        hint="จัดหมวดสำเร็จ แต่ไม่ตรงกับหัวข้อที่มีอยู่ — enum อาจต้องเพิ่ม"
      />
      <StatCard
        icon={<VolumeX size={15} />}
        label="เงียบ/ขยะ"
        value={stats.noise_count}
        prevValue={prevStats?.noise_count}
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
  emphasis = false,
  invertDelta = false,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  prevValue?: number;
  hint?: string;
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
        <span className="text-gray-500" style={{ fontSize: "0.78rem", fontWeight: 500 }} title={hint}>
          {label}
        </span>
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
