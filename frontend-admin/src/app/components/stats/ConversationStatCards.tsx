import type { ReactNode } from "react";
import { MessageSquareText, HelpCircle, Tags, VolumeX } from "lucide-react";
import type { ConversationStatsOut } from "../../../lib/api";

interface ConversationStatCardsProps {
  stats: ConversationStatsOut;
}

// unclassified/other ต้องเป็นตัวเลขที่เห็นง่าย (ผู้ว่าจ้างใช้ดูว่า enum ครอบพอไหม/classifier
// ทำงานปกติไหม) — ให้ขนาดตัวเลขเท่ากับการ์ดหลัก ไม่ใช่ตัวเล็กจิ๋วแบบรายละเอียดรอง
export function ConversationStatCards({ stats }: ConversationStatCardsProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
      <StatCard
        icon={<MessageSquareText size={13} className="text-gray-400" />}
        label="จำนวนบทสนทนา"
        value={stats.total_conversations}
        emphasis
      />
      <StatCard
        icon={<HelpCircle size={13} className="text-amber-500" />}
        label="ยังไม่จัดหมวด (Unclassified)"
        value={stats.unclassified_count}
        tone="amber"
        hint="classify ยังไม่จบ/ล้มเหลว หรือไม่มีสัญญาณให้จัดหมวดเลย"
      />
      <StatCard
        icon={<Tags size={13} className="text-sky-500" />}
        label="อื่น ๆ (Other)"
        value={stats.other_count}
        tone="sky"
        hint="จัดหมวดสำเร็จ แต่ไม่ตรงกับหัวข้อที่มีอยู่ — enum อาจต้องเพิ่ม"
      />
      <StatCard
        icon={<VolumeX size={13} className="text-gray-400" />}
        label="เงียบ/ขยะ (Noise)"
        value={stats.noise_count}
        tone="gray"
        hint="ไม่นับรวมในจำนวนบทสนทนา"
      />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
  tone = "default",
  emphasis = false,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  hint?: string;
  tone?: "default" | "amber" | "sky" | "gray";
  emphasis?: boolean;
}) {
  const valueColor =
    tone === "amber" ? "text-amber-700" : tone === "sky" ? "text-sky-700" : "text-gray-900";
  const border = tone === "amber" ? "border-amber-100" : tone === "sky" ? "border-sky-100" : "border-gray-100";

  return (
    <div className={`bg-white rounded-xl border ${border} shadow-sm p-4 flex flex-col gap-2.5`}>
      <span className="text-gray-700 flex items-center gap-1.5" style={{ fontSize: "0.78rem", fontWeight: 600 }}>
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
      {hint && (
        <p className="text-gray-400" style={{ fontSize: "0.68rem", lineHeight: 1.4 }}>
          {hint}
        </p>
      )}
    </div>
  );
}
