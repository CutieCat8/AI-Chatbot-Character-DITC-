import { ListChecks } from "lucide-react";

interface AnswerStatusBarsProps {
  answeredCount: number;
  offTopicOnlyCount: number;
  greetingOnlyCount: number;
}

// 3 กลุ่มนี้ไม่ overlap กันเลย (ดู routers/stats.py) — ผลรวมเท่ากับ total_conversations เป๊ะเสมอ
// ลำดับ: ตอบได้ (เคย search จริง) ชนะเสมอ > นอกขอบเขตอย่างเดียว > ทักทาย/small-talk ล้วน ๆ
const ROWS = [
  { key: "answered", label: "ตอบได้จากฐานความรู้", color: "#111827" }, // gray-900
  { key: "off_topic", label: "ถามนอกขอบเขต", color: "#9CA3AF" }, // gray-400
  { key: "greeting", label: "ทักทาย/คุยเล่นอย่างเดียว", color: "#E5E7EB" }, // gray-200
] as const;

const BAR_TRACK_HEIGHT = 88; // px — ความสูงเต็มแท่งตอน 100%

// เลย์เอาต์แบบภาพอ้างอิงที่ผู้ว่าจ้างส่งมา (การ์ด "Finance Balance") — legend list ทางซ้าย + แท่ง
// แนวตั้งทางขวาแทนความยาวเปอร์เซ็นต์ ต่างจากเดิมที่เป็น progress bar แนวนอนใต้ label แต่ละแถว
export function AnswerStatusBars({ answeredCount, offTopicOnlyCount, greetingOnlyCount }: AnswerStatusBarsProps) {
  const values: Record<(typeof ROWS)[number]["key"], number> = {
    answered: answeredCount,
    off_topic: offTopicOnlyCount,
    greeting: greetingOnlyCount,
  };
  const total = answeredCount + offTopicOnlyCount + greetingOnlyCount;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3 transition-all duration-300 ease-out hover:shadow-lg hover:border-gray-200">
      <span className="text-gray-700 flex items-center gap-1.5" style={{ fontSize: "0.8rem", fontWeight: 600 }}>
        <ListChecks size={13} className="text-gray-400" />
        สถานะการค้นข้อมูล
      </span>

      {total === 0 ? (
        <p className="text-gray-300 py-4 text-center" style={{ fontSize: "0.8rem" }}>
          ยังไม่มีข้อมูลในช่วงนี้
        </p>
      ) : (
        <div className="flex items-center gap-4">
          <div className="flex-1 flex flex-col gap-3 min-w-0">
            {ROWS.map((row) => {
              const count = values[row.key];
              const pct = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <div key={row.key} className="group flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: row.color }} />
                  <span
                    className="flex-1 truncate text-gray-600 transition-colors duration-150 group-hover:text-gray-900"
                    style={{ fontSize: "0.75rem", fontWeight: 500 }}
                  >
                    {row.label}
                  </span>
                  <span className="text-gray-900 shrink-0" style={{ fontSize: "0.75rem", fontWeight: 600 }}>
                    {pct}% <span className="text-gray-400" style={{ fontWeight: 400 }}>({count})</span>
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex items-end gap-2.5 shrink-0" style={{ height: BAR_TRACK_HEIGHT }}>
            {ROWS.map((row) => {
              const count = values[row.key];
              const pct = total > 0 ? (count / total) * 100 : 0;
              return (
                <div
                  key={row.key}
                  className="w-3.5 rounded-full bg-gray-100 relative overflow-hidden transition-transform duration-200 ease-out hover:scale-x-125"
                  style={{ height: "100%" }}
                  title={`${row.label} · ${pct.toFixed(0)}%`}
                >
                  <div
                    className="absolute bottom-0 left-0 w-full rounded-full transition-all duration-500 ease-out hover:brightness-125"
                    style={{ height: `${pct}%`, background: row.color }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
