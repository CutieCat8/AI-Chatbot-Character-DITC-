import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import { getConversationStats, type ConversationStatsOut } from "../../lib/api";
import { DateRangeControl, defaultDateRange } from "../components/stats/DateRangeControl";
import { ConversationStatCards } from "../components/stats/ConversationStatCards";
import { ConversationTrendChart } from "../components/stats/ConversationTrendChart";
import { TopicBreakdownList } from "../components/stats/TopicBreakdownList";

export default function StatsPage() {
  const [[start, end], setRange] = useState<[string, string]>(defaultDateRange());
  const [stats, setStats] = useState<ConversationStatsOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getConversationStats(start, end)
      .then((res) => {
        if (cancelled) return;
        setStats(res);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [start, end]);

  // "ยังไม่มีข้อมูลเลย" = ไม่มีบทสนทนาแม้แต่แถวเดียวในช่วงที่เลือก (นับทุกสถานะรวม noise) —
  // ต่างจาก error/loading ต้องแสดง empty state ที่อธิบายได้ ไม่ใช่หน้าว่างหรือกราฟ 0 ที่ดูเหมือนพัง
  const isEmpty =
    stats !== null &&
    stats.total_conversations === 0 &&
    stats.noise_count === 0 &&
    stats.unclassified_count === 0;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-screen-xl mx-auto w-full px-8 py-10">
        <h1 className="text-gray-900" style={{ fontSize: "1.75rem", fontWeight: 700, letterSpacing: "-0.03em" }}>
          สถิติบทสนทนา
        </h1>
        <p className="text-gray-400 mt-1.5" style={{ fontSize: "0.85rem" }}>
          สรุปหัวข้อบทสนทนาที่ผู้ใช้ถาม DITC CAT — ไม่มีบทสนทนาดิบ เก็บแค่หัวข้อสรุปตามข้อกำหนด PDPA
        </p>

        <div className="mt-6">
          <DateRangeControl start={start} end={end} onChange={(s, e) => setRange([s, e])} />
        </div>

        <div className="mt-6 flex flex-col gap-4">
          {loading && (
            <div className="py-24 text-center text-gray-300" style={{ fontSize: "0.85rem" }}>
              กำลังโหลด...
            </div>
          )}

          {!loading && error && (
            <div className="py-24 text-center text-red-400" style={{ fontSize: "0.85rem" }}>
              เชื่อมต่อ API ไม่สำเร็จ: {error}
            </div>
          )}

          {!loading && !error && stats && isEmpty && (
            <div className="py-24 flex flex-col items-center gap-2.5 text-center">
              <BarChart3 size={28} className="text-gray-200" />
              <p className="text-gray-400" style={{ fontSize: "0.85rem", fontWeight: 500 }}>
                ยังไม่มีบทสนทนาในช่วงวันที่เลือกเลย
              </p>
              <p className="text-gray-300" style={{ fontSize: "0.75rem" }}>
                ลองเลือกช่วงวันที่อื่น หรือรอให้มีคนคุยกับตู้ก่อน
              </p>
            </div>
          )}

          {!loading && !error && stats && !isEmpty && (
            <>
              <ConversationStatCards stats={stats} />
              <ConversationTrendChart dailyCounts={stats.daily_counts} />
              <TopicBreakdownList topics={stats.top_topics} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
