import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { Sparkles } from "lucide-react";

interface ConversationQualityDonutProps {
  totalConversations: number;
  noiseCount: number;
}

// สองสีเดียวกับแถบ Storage ใน StatusPanel.tsx (gray-800/gray-300) — คงโทนเดียวกับที่เหลือของแอป
const REAL_COLOR = "#1F2937"; // gray-800
const TRACK_COLOR = "#E5E7EB"; // gray-200

// สัดส่วน "บทสนทนาที่มีคำถามจริง" เทียบกับ "เสียงรบกวน/คนเดินผ่าน" (noise) จาก grand total ทั้งหมด —
// สองก้อนนี้ไม่ overlap กันเลย (ตัดสินใจแล้วที่ session_tracker.py: NOISE คือไม่เคยเรียก search/
// off_topic เลยสักครั้ง) ต่างจาก unclassified/other ที่เป็น tag ซ้อนกันได้ ใช้ทำเกจแบบนี้ไม่ได้ตรง ๆ
//
// เกจครึ่งวงกลม (แทนโดนัทเต็มวงเดิม) ตามภาพอ้างอิงที่ผู้ว่าจ้างส่งมา (Customer Satisfaction Score
// gauge) — ทำด้วย Pie ตัวเดียวกัน แค่ตั้ง startAngle/endAngle ให้กวาดครึ่งบนแทนเต็มวง
export function ConversationQualityDonut({ totalConversations, noiseCount }: ConversationQualityDonutProps) {
  const grandTotal = totalConversations + noiseCount;
  const realPct = grandTotal > 0 ? Math.round((totalConversations / grandTotal) * 100) : 0;
  const data = [
    { name: "บทสนทนาจริง", value: realPct },
    { name: "เสียงรบกวน", value: 100 - realPct },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3.5">
      <span className="text-gray-700 flex items-center gap-1.5" style={{ fontSize: "0.8rem", fontWeight: 600 }}>
        <Sparkles size={13} className="text-gray-400" />
        คุณภาพสัญญาณ
      </span>

      {grandTotal === 0 ? (
        <p className="text-gray-300 py-10 text-center" style={{ fontSize: "0.8rem" }}>
          ยังไม่มีข้อมูลในช่วงนี้
        </p>
      ) : (
        <>
          <div className="relative" style={{ width: "100%", height: 130 }}>
            <ResponsiveContainer>
              <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="100%"
                  innerRadius={72}
                  outerRadius={104}
                  cornerRadius={6}
                  paddingAngle={2}
                  stroke="none"
                  startAngle={180}
                  endAngle={0}
                >
                  <Cell fill={REAL_COLOR} />
                  <Cell fill={TRACK_COLOR} />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-x-0 bottom-0 flex flex-col items-center pointer-events-none">
              <span className="text-gray-900" style={{ fontSize: "1.9rem", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1 }}>
                {realPct}
                <span className="text-gray-400" style={{ fontSize: "1rem", fontWeight: 600 }}>
                  /100
                </span>
              </span>
              <span className="text-gray-400 mt-0.5" style={{ fontSize: "0.68rem" }}>
                เป็นคำถามจริง
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: REAL_COLOR }} />
              <span className="flex-1 text-gray-600" style={{ fontSize: "0.78rem", fontWeight: 500 }}>
                บทสนทนาจริง
              </span>
              <span className="text-gray-900" style={{ fontSize: "0.78rem", fontWeight: 600 }}>
                {totalConversations.toLocaleString("th-TH")}
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: TRACK_COLOR }} />
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
