import { BarChart3 } from "lucide-react";
import type { TopicCountOut } from "../../../lib/api";

interface TopicBreakdownListProps {
  topics: TopicCountOut[];
}

// เรียงมากไปน้อยมาจาก backend อยู่แล้ว (Counter.most_common()) — ไม่ sort ซ้ำที่นี่
export function TopicBreakdownList({ topics }: TopicBreakdownListProps) {
  const max = topics.reduce((m, t) => Math.max(m, t.count), 0) || 1;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3.5">
      <span className="text-gray-700 flex items-center gap-1.5" style={{ fontSize: "0.8rem", fontWeight: 600 }}>
        <BarChart3 size={13} className="text-gray-400" />
        หัวข้อยอดนิยม
      </span>

      {topics.length === 0 ? (
        <p className="text-gray-300 py-6 text-center" style={{ fontSize: "0.8rem" }}>
          ยังไม่มีบทสนทนาที่จัดหมวดได้ในช่วงนี้
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {topics.map((t) => (
            <div key={t.topic} className="flex items-center gap-3">
              <span
                className={`shrink-0 truncate ${t.topic === "other" ? "text-sky-600" : "text-gray-600"}`}
                style={{ fontSize: "0.76rem", width: "11rem" }}
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
