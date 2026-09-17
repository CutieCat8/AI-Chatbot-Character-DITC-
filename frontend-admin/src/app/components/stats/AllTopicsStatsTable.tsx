import { useMemo, useState } from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ListTree } from "lucide-react";
import type { TopicCountOut } from "../../../lib/api";

interface AllTopicsStatsTableProps {
  topics: TopicCountOut[];
}

type SortDir = "desc" | "asc";

// ตารางหัวข้อ "ครบทุกหัวข้อ" คู่กับโดนัท "หัวข้อยอดนิยม" ที่ตัดโชว์แค่ top 4 (ดู TopicDonutCard.tsx)
// — ไว้ตอบคำถามแบบ "ทำไม MMIT/ANI ไม่ขึ้นในโดนัท" ได้ตรง ๆ โดยไม่ต้องไปเปิด DB ดูเอง ข้อมูลมาจาก
// stats.top_topics ตัวเดียวกับโดนัท (backend ส่งมาครบทุกหัวข้อที่มี tag จริงอยู่แล้ว ไม่ได้ตัดที่ backend)
export function AllTopicsStatsTable({ topics }: AllTopicsStatsTableProps) {
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { rows, max } = useMemo(() => {
    const sorted = [...topics].sort((a, b) => (sortDir === "desc" ? b.count - a.count : a.count - b.count));
    const max = topics.reduce((m, t) => Math.max(m, t.count), 0) || 1;
    return { rows: sorted, max };
  }, [topics, sortDir]);

  const total = useMemo(() => topics.reduce((sum, t) => sum + t.count, 0), [topics]);

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3.5">
      <div className="flex items-center justify-between">
        <span className="text-gray-700 flex items-center gap-1.5" style={{ fontSize: "0.8rem", fontWeight: 600 }}>
          <ListTree size={13} className="text-gray-400" />
          สถิติหัวข้อทั้งหมด
        </span>

        <div className="flex items-center gap-1 bg-gray-50 border border-gray-100 rounded-lg p-0.5">
          <button
            onClick={() => setSortDir("desc")}
            className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${
              sortDir === "desc" ? "bg-white shadow-sm text-gray-900" : "text-gray-400 hover:text-gray-600"
            }`}
            style={{ fontSize: "0.72rem", fontWeight: 600 }}
          >
            <ArrowDownWideNarrow size={12} />
            มาก→น้อย
          </button>
          <button
            onClick={() => setSortDir("asc")}
            className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${
              sortDir === "asc" ? "bg-white shadow-sm text-gray-900" : "text-gray-400 hover:text-gray-600"
            }`}
            style={{ fontSize: "0.72rem", fontWeight: 600 }}
          >
            <ArrowUpNarrowWide size={12} />
            น้อย→มาก
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-gray-300 py-6 text-center" style={{ fontSize: "0.8rem" }}>
          ยังไม่มีบทสนทนาที่จัดหมวดได้ในช่วงนี้
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((t) => (
            <div key={t.topic} className="flex items-center gap-3">
              <span
                className={`shrink-0 truncate ${t.topic === "other" ? "text-sky-600" : "text-gray-600"}`}
                style={{ fontSize: "0.76rem", width: "13rem" }}
                title={t.label}
              >
                {t.label}
              </span>
              <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className={t.topic === "other" ? "h-full bg-sky-400" : "h-full bg-gray-800"}
                  style={{ width: `${(t.count / max) * 100}%` }}
                />
              </div>
              <span className="text-gray-400 shrink-0 text-right" style={{ fontSize: "0.72rem", width: "2.75rem" }}>
                {total > 0 ? Math.round((t.count / total) * 100) : 0}%
              </span>
              <span className="text-gray-700 shrink-0 text-right" style={{ fontSize: "0.78rem", fontWeight: 600, width: "2rem" }}>
                {t.count}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
