import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { PieChart as PieIcon } from "lucide-react";
import type { TopicCountOut } from "../../../lib/api";

interface TopicDonutCardProps {
  topics: TopicCountOut[];
}

// ไล่โทนเทาเข้ม->อ่อนเหมือนแถบ Storage ใน StatusPanel.tsx (ไม่ใช้สีหลากเฉด — คงโทนเดียวกับที่เหลือ
// ของแอป) ยกเว้น "other" ที่ยังใช้ sky ตามธรรมเนียมเดิม (TopicBreakdownList.tsx ก่อนหน้านี้ก็ไฮไลต์
// other เป็น sky เหมือนกัน — หมายถึง "จัดหมวดสำเร็จแต่ไม่ตรง enum ที่มี" ต้องการให้สังเกตเห็นง่าย)
const GRAY_RAMP = ["#111827", "#4B5563", "#9CA3AF", "#D1D5DB", "#E5E7EB"];
const OTHER_COLOR = "#38BDF8"; // sky-400
const MAX_SLICES = 4;

export function TopicDonutCard({ topics }: TopicDonutCardProps) {
  const { slices, total } = useMemo(() => {
    const top = topics.slice(0, MAX_SLICES);
    const restCount = topics.slice(MAX_SLICES).reduce((sum, t) => sum + t.count, 0);
    const rows = restCount > 0 ? [...top, { topic: "__rest__", label: "อื่น ๆ ที่เหลือ", count: restCount }] : top;
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    return { slices: rows, total };
  }, [topics]);

  const colorFor = (topic: string, i: number) => (topic === "other" ? OTHER_COLOR : GRAY_RAMP[i % GRAY_RAMP.length]);

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3.5">
      <span className="text-gray-700 flex items-center gap-1.5" style={{ fontSize: "0.8rem", fontWeight: 600 }}>
        <PieIcon size={13} className="text-gray-400" />
        หัวข้อยอดนิยม
      </span>

      {slices.length === 0 ? (
        <p className="text-gray-300 py-10 text-center" style={{ fontSize: "0.8rem" }}>
          ยังไม่มีบทสนทนาที่จัดหมวดได้ในช่วงนี้
        </p>
      ) : (
        <>
          <div className="relative" style={{ width: "100%", height: 170 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="count"
                  nameKey="label"
                  innerRadius={52}
                  outerRadius={78}
                  paddingAngle={3}
                  stroke="none"
                  startAngle={90}
                  endAngle={-270}
                >
                  {slices.map((s, i) => (
                    <Cell key={s.topic} fill={colorFor(s.topic, i)} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              {/* total ตรงนี้คือผลรวม "ครั้งที่ติดแท็ก" ไม่ใช่จำนวนบทสนทนา — หนึ่งบทสนทนาติดได้หลาย
                  tag (ดู Topic enum ใน backend/app/models/enums.py) เลยอาจมากกว่า total_conversations */}
              <span className="text-gray-900" style={{ fontSize: "1.4rem", fontWeight: 700, letterSpacing: "-0.03em" }}>
                {total.toLocaleString("th-TH")}
              </span>
              <span className="text-gray-400" style={{ fontSize: "0.68rem" }}>
                ครั้งที่ติดแท็ก
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            {slices.map((s, i) => (
              <div key={s.topic} className="flex items-center gap-2.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: colorFor(s.topic, i) }} />
                <span
                  className={`flex-1 truncate ${s.topic === "other" ? "text-sky-600" : "text-gray-600"}`}
                  style={{ fontSize: "0.78rem", fontWeight: 500 }}
                  title={s.label}
                >
                  {s.label}
                </span>
                <span className="text-gray-400" style={{ fontSize: "0.72rem", fontWeight: 600 }}>
                  {total > 0 ? Math.round((s.count / total) * 100) : 0}%
                </span>
                <span
                  className="text-gray-700 text-right"
                  style={{ fontSize: "0.78rem", fontWeight: 600, width: "2.25rem" }}
                >
                  {s.count.toLocaleString("th-TH")}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
