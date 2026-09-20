import { useMemo, useState } from "react";
import { PieChart as PieIcon } from "lucide-react";
import type { TopicCountOut } from "../../../lib/api";
import { DitherDonutRing } from "./DitherDonutRing";
import { OTHER_TOPIC_COLOR, TOPIC_COLORS } from "./chartPalette";

interface TopicDonutCardProps {
  topics: TopicCountOut[];
}

// ไล่โทนเทาเข้ม->อ่อนเหมือนแถบ Storage ใน StatusPanel.tsx (ไม่ใช้สีหลากเฉด — คงโทนเดียวกับที่เหลือ
// ของแอป) ยกเว้น "other" ที่ไฮไลต์แยกให้สังเกตง่าย — เดิมใช้ sky แต่ชนความหมาย "syncing/live" ที่
// sky มีอยู่แล้วใน StatusPanel.tsx เปลี่ยนมาใช้ teal แทน (2026-09-17 ผู้ว่าจ้างขอ ไม่เข้าธีม)
const MAX_SLICES = 4;

export function TopicDonutCard({ topics }: TopicDonutCardProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const { slices, total } = useMemo(() => {
    const top = topics.slice(0, MAX_SLICES);
    const restCount = topics.slice(MAX_SLICES).reduce((sum, t) => sum + t.count, 0);
    const rows = restCount > 0 ? [...top, { topic: "__rest__", label: "อื่น ๆ ที่เหลือ", count: restCount }] : top;
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    return { slices: rows, total };
  }, [topics]);

  const colorFor = (topic: string, i: number) =>
    topic === "other" ? OTHER_TOPIC_COLOR : TOPIC_COLORS[i % TOPIC_COLORS.length];
  const active = activeIndex !== null ? slices[activeIndex] : null;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3.5 transition-all duration-300 ease-out hover:shadow-lg hover:border-gray-200">
      <div className="flex items-center justify-between gap-2">
        <span className="text-gray-700 flex items-center gap-1.5 shrink-0" style={{ fontSize: "0.8rem", fontWeight: 600 }}>
          <PieIcon size={13} className="text-gray-400" />
          หัวข้อยอดนิยม
        </span>
        {/* รายละเอียดตอนชี้เมาส์อยู่นอกวงกลมตรงนี้แทนตัวเลขกลางวง — เดิมโชว์ตรงกลางแล้วโดนวงแหวนบัง/
            ตัดคำเมื่อชื่อหัวข้อยาว (เจอจริงตอนทดสอบ) ย้ายมาไว้เป็น pill เหมือนกราฟแท่งแทน มีที่ให้ข้อความ
            เต็มบรรทัดไม่โดนบัง */}
        {/* ตัว pill ต้อง mount อยู่ตลอด (แค่สลับ opacity) ไม่ใช่ conditional render — ถ้า mount/
            unmount ตามการ hover แถวหัวข้อจะเปลี่ยนความสูง (padding ของ pill สูงกว่าตัวหนังสือเปล่า ๆ)
            ทำให้ทั้งการ์ดขยับตอนชี้เมาส์ (เจอจริงตอนทดสอบ) — เว้นที่ไว้เท่ากันตลอดแทน */}
        <span
          className={`rounded-full px-2.5 py-1 bg-gray-100 text-gray-700 truncate min-w-0 transition-opacity duration-150 ${
            active ? "opacity-100" : "opacity-0"
          }`}
          style={{ fontSize: "0.7rem", fontWeight: 600 }}
          title={active?.label}
        >
          {active ? `${active.label} · ${active.count.toLocaleString("th-TH")}` : " "}
        </span>
      </div>

      {slices.length === 0 ? (
        <p className="text-gray-300 py-10 text-center" style={{ fontSize: "0.8rem" }}>
          ยังไม่มีบทสนทนาที่จัดหมวดได้ในช่วงนี้
        </p>
      ) : (
        <>
          <div
            className="relative flex items-center justify-center rounded-[14px] overflow-hidden bg-[#f4f4f6]"
            style={{ width: "100%", height: 170 }}
          >
            <DitherDonutRing
              slices={slices.map((s, i) => ({ key: s.topic, value: s.count, color: colorFor(s.topic, i) }))}
              activeIndex={activeIndex}
              onHoverIndex={setActiveIndex}
              size={170}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              {/* total ตรงนี้คือผลรวม "ครั้งที่ติดแท็ก" ไม่ใช่จำนวนบทสนทนา — หนึ่งบทสนทนาติดได้หลาย
                  tag (ดู Topic enum ใน backend/app/models/enums.py) เลยอาจมากกว่า total_conversations
                  ค่ากลางวงคงที่เสมอไม่สลับตามที่ชี้เมาส์แล้ว (ดูรายละเอียด pill ที่ header แทน) */}
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
              <div
                key={s.topic}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseLeave={() => setActiveIndex(null)}
                className={`flex items-center gap-2.5 -mx-1.5 px-1.5 py-0.5 rounded-md cursor-pointer transition-colors duration-150 ${
                  activeIndex === i ? "bg-gray-50" : ""
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0 transition-transform duration-150"
                  style={{ background: colorFor(s.topic, i), transform: activeIndex === i ? "scale(1.4)" : "scale(1)" }}
                />
                <span
                  className={`flex-1 truncate ${s.topic === "other" ? "text-teal-600" : "text-gray-600"}`}
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
