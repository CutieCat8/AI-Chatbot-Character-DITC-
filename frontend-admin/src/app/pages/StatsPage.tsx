import { useEffect, useState } from "react";
import { BarChart3, FileDown } from "lucide-react";
import { getConversationStats, type ConversationStatsOut } from "../../lib/api";
import { DateRangeControl, defaultDateRange } from "../components/stats/DateRangeControl";
import { ConversationStatCards } from "../components/stats/ConversationStatCards";
import { ConversationTrendChart } from "../components/stats/ConversationTrendChart";
import { TopicDonutCard } from "../components/stats/TopicDonutCard";
import { ConversationQualityDonut } from "../components/stats/ConversationQualityDonut";
import { AllTopicsStatsTable } from "../components/stats/AllTopicsStatsTable";
import { AnswerStatusBars } from "../components/stats/AnswerStatusBars";
import { exportStatisticsPdf } from "../components/stats/exportStatisticsPdf";

// ช่วงก่อนหน้าที่ "ยาวเท่ากัน" ต่อจากช่วงที่เลือกทันที — ใช้ทำ delta "เทียบช่วงก่อนหน้า" บนการ์ด KPI
// ไม่ hardcode เป็น "เทียบสัปดาห์ก่อน" เพราะผู้ใช้เลือกช่วงวันที่เองได้ยาวสั้นไม่เท่ากัน คำนวณสด ๆ
// ฝั่ง frontend ล้วน ไม่แตะ backend เลย (เหมือน preset ใน DateRangeControl.tsx)
function previousPeriod(start: string, end: string): [string, string] {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  const spanDays = Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1;
  const prevEnd = new Date(s.getTime() - 86_400_000);
  const prevStart = new Date(prevEnd.getTime() - (spanDays - 1) * 86_400_000);
  return [prevStart.toISOString().slice(0, 10), prevEnd.toISOString().slice(0, 10)];
}

export default function StatsPage() {
  const [[start, end], setRange] = useState<[string, string]>(defaultDateRange());
  const [stats, setStats] = useState<ConversationStatsOut | null>(null);
  const [prevStats, setPrevStats] = useState<ConversationStatsOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const [prevStart, prevEnd] = previousPeriod(start, end);

    Promise.all([
      getConversationStats(start, end),
      // เทียบช่วงก่อนหน้าเป็นของเสริม ไม่ใช่ข้อมูลหลัก — พังได้โดยไม่บล็อกหน้าเลย (แค่ไม่มี delta โชว์)
      getConversationStats(prevStart, prevEnd).catch(() => null),
    ])
      .then(([res, prevRes]) => {
        if (cancelled) return;
        setStats(res);
        setPrevStats(prevRes);
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
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-gray-900" style={{ fontSize: "1.75rem", fontWeight: 700, letterSpacing: "-0.03em" }}>
              สถิติบทสนทนา
            </h1>
            <p className="text-gray-400 mt-1.5" style={{ fontSize: "0.85rem" }}>
              สรุปหัวข้อบทสนทนาที่ผู้ใช้ถาม DITC CAT — ไม่มีบทสนทนาดิบ เก็บแค่หัวข้อสรุปตามข้อกำหนด PDPA
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <DateRangeControl start={start} end={end} onChange={(s, e) => setRange([s, e])} />
            <button
              type="button"
              disabled={loading || Boolean(error) || !stats || isEmpty}
              onClick={() => {
                if (stats && !exportStatisticsPdf(stats, start, end)) {
                  window.alert("เบราว์เซอร์บล็อกหน้าต่างรายงาน กรุณาอนุญาต Pop-up แล้วลองอีกครั้ง");
                }
              }}
              className="flex items-center gap-1.5 rounded-lg border border-gray-900 bg-gray-900 px-3 py-2 text-white shadow-sm transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-200"
              style={{ fontSize: "0.78rem", fontWeight: 600 }}
            >
              <FileDown size={14} />
              ส่งออก PDF
            </button>
          </div>
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
            <div className="grid grid-cols-12 gap-4 items-start">
              <div className="col-span-12 xl:col-span-8 flex flex-col gap-4">
                <ConversationStatCards stats={stats} prevStats={prevStats} />
                <ConversationTrendChart dailyCounts={stats.daily_counts} />
                <AllTopicsStatsTable topics={stats.top_topics} />
              </div>
              <div className="col-span-12 xl:col-span-4 flex flex-col gap-4">
                <TopicDonutCard topics={stats.top_topics} />
                <AnswerStatusBars
                  answeredCount={stats.answered_count}
                  offTopicOnlyCount={stats.off_topic_only_count}
                  greetingOnlyCount={stats.greeting_only_count}
                />
                <ConversationQualityDonut
                  totalConversations={stats.total_conversations}
                  noiseCount={stats.noise_count}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
