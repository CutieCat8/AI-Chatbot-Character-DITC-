import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { Sparkles } from "lucide-react";
import { QUALITY_COLORS } from "./chartPalette";

interface ConversationQualityDonutProps {
  totalConversations: number;
  noiseCount: number;
}

// สองสีเดียวกับแถบ Storage ใน StatusPanel.tsx (gray-800/gray-300) — คงโทนเดียวกับที่เหลือของแอป
const REAL_COLOR = QUALITY_COLORS.conversation;
const TRACK_COLOR = QUALITY_COLORS.noise;

// สัดส่วน "บทสนทนาที่มีคำถามจริง" เทียบกับ "เสียงรบกวน/คนเดินผ่าน" (noise) จาก grand total ทั้งหมด —
// สองก้อนนี้ไม่ overlap กันเลย (ตัดสินใจแล้วที่ session_tracker.py: NOISE คือไม่เคยเรียก search/
// off_topic เลยสักครั้ง) ต่างจาก unclassified/other ที่เป็น tag ซ้อนกันได้ ใช้ทำเกจแบบนี้ไม่ได้ตรง ๆ
//
// เกจโค้ง 240° ปลายมน อ้างอิงรูปแบบ Mono Rounded Gauge Arc ของ Amicro
export function ConversationQualityDonut({ totalConversations, noiseCount }: ConversationQualityDonutProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const grandTotal = totalConversations + noiseCount;
  const realPct = grandTotal > 0 ? Math.round((totalConversations / grandTotal) * 100) : 0;
  const data = [
    { name: "บทสนทนาจริง", value: realPct, count: totalConversations },
    { name: "เสียงรบกวน", value: 100 - realPct, count: noiseCount },
  ];
  const active = activeIndex !== null ? data[activeIndex] : null;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3.5 transition-all duration-300 ease-out hover:shadow-lg hover:border-gray-200">
      <div className="flex items-center justify-between gap-2">
        <span className="text-gray-700 flex items-center gap-1.5 shrink-0" style={{ fontSize: "0.8rem", fontWeight: 600 }}>
          <Sparkles size={13} className="text-gray-400" />
          คุณภาพสัญญาณ
        </span>
        {/* ย้ายรายละเอียดตอนชี้เมาส์ออกมานอกวงกลม เหมือน TopicDonutCard.tsx — กันไม่ให้ข้อความโดน
            วงแหวนบัง/ตัดตอนชี้ — mount ตลอด สลับแค่ opacity (เหตุผลเดียวกับ TopicDonutCard.tsx:
            ถ้า mount/unmount ตามการ hover แถวหัวข้อจะสูงไม่เท่ากันจนการ์ดขยับ) */}
        <span
          className={`rounded-full px-2.5 py-1 bg-gray-100 text-gray-700 truncate min-w-0 transition-opacity duration-150 ${
            active ? "opacity-100" : "opacity-0"
          }`}
          style={{ fontSize: "0.7rem", fontWeight: 600 }}
        >
          {active ? `${active.name} · ${active.count.toLocaleString("th-TH")}` : " "}
        </span>
      </div>

      {grandTotal === 0 ? (
        <p className="text-gray-300 py-10 text-center" style={{ fontSize: "0.8rem" }}>
          ยังไม่มีข้อมูลในช่วงนี้
        </p>
      ) : (
        <>
          <div
            className="relative rounded-[14px] overflow-hidden bg-[#f4f4f6]"
            style={{ width: "100%", height: 150 }}
          >
            <ResponsiveContainer>
              <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="70%"
                  innerRadius={54}
                  outerRadius={72}
                  cornerRadius={8}
                  paddingAngle={4}
                  stroke="none"
                  strokeLinecap="round"
                  startAngle={210}
                  endAngle={-30}
                  onMouseEnter={(_, i) => setActiveIndex(i)}
                  onMouseLeave={() => setActiveIndex(null)}
                >
                  <Cell fill={REAL_COLOR} style={{ cursor: "pointer" }} />
                  <Cell fill={TRACK_COLOR} style={{ cursor: "pointer" }} />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-x-0 bottom-3 flex flex-col items-center pointer-events-none">
              {/* ค่ากลางเกจคงที่เสมอไม่สลับตามที่ชี้เมาส์แล้ว (ดูรายละเอียด pill ที่ header แทน) */}
              <span className="text-gray-900 tabular-nums" style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1 }}>
                {realPct}
                <span className="text-gray-400" style={{ fontSize: "0.82rem", fontWeight: 600 }}>
                  /100
                </span>
              </span>
              <span className="text-gray-400 mt-0.5" style={{ fontSize: "0.68rem" }}>
                เป็นคำถามจริง
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <div
              onMouseEnter={() => setActiveIndex(0)}
              onMouseLeave={() => setActiveIndex(null)}
              className={`flex items-center gap-2.5 -mx-1.5 px-1.5 py-0.5 rounded-md cursor-pointer transition-colors duration-150 ${
                activeIndex === 0 ? "bg-gray-50" : ""
              }`}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0 transition-transform duration-150"
                style={{ background: REAL_COLOR, transform: activeIndex === 0 ? "scale(1.4)" : "scale(1)" }}
              />
              <span className="flex-1 text-gray-600" style={{ fontSize: "0.78rem", fontWeight: 500 }}>
                บทสนทนาจริง
              </span>
              <span className="text-gray-900" style={{ fontSize: "0.78rem", fontWeight: 600 }}>
                {totalConversations.toLocaleString("th-TH")}
              </span>
            </div>
            <div
              onMouseEnter={() => setActiveIndex(1)}
              onMouseLeave={() => setActiveIndex(null)}
              className={`flex items-center gap-2.5 -mx-1.5 px-1.5 py-0.5 rounded-md cursor-pointer transition-colors duration-150 ${
                activeIndex === 1 ? "bg-gray-50" : ""
              }`}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0 transition-transform duration-150"
                style={{ background: TRACK_COLOR, transform: activeIndex === 1 ? "scale(1.4)" : "scale(1)" }}
              />
              <span className="flex-1 text-gray-600" style={{ fontSize: "0.78rem", fontWeight: 500 }}>
                เสียงรบกวน
              </span>
              <span className="text-gray-900" style={{ fontSize: "0.78rem", fontWeight: 600 }}>
                {noiseCount.toLocaleString("th-TH")}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
