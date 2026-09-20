import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TrendingUp } from "lucide-react";
import type { DailyConversationCountOut } from "../../../lib/api";
import { TREND_COLORS } from "./chartPalette";

interface ConversationTrendChartProps {
  dailyCounts: DailyConversationCountOut[];
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short" });
}

export function ConversationTrendChart({ dailyCounts }: ConversationTrendChartProps) {
  const data = useMemo(() => dailyCounts.map((d) => ({ ...d, label: formatDay(d.date) })), [dailyCounts]);
  // ค่าเริ่มต้นที่ไฮไลต์ = วันที่มีบทสนทนาเยอะสุดในช่วงที่เลือก (ไม่ใช่วันสุดท้าย) — ให้เห็นจุดเด่นทันที
  // โดยไม่ต้องเอาเมาส์ไปชี้ก่อน
  const peakIndex = useMemo(() => {
    if (data.length === 0) return -1;
    let idx = 0;
    for (let i = 1; i < data.length; i++) if (data[i].count > data[idx].count) idx = i;
    return idx;
  }, [data]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const highlighted = activeIndex ?? peakIndex;

  return (
    <div className="trend-chart-scope bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3 transition-all duration-300 ease-out hover:shadow-lg hover:border-gray-200">
      {/* transition บน .recharts-rectangle เอง (แทน CSS class ปกติ) เพราะ Cell/Bar ของ recharts
          re-render fill ผ่าน inline attribute ทุกครั้งที่ highlighted เปลี่ยน — ต้องมี transition
          ที่ตัว <path> จริงถึงจะเห็นสีไล่เรียบ ๆ ตอนเมาส์เลื่อนแท่งไปมา ไม่ใช่กระพริบเปลี่ยนทันที */}
      <style>{`
        .trend-chart-scope .recharts-rectangle {
          transition: fill 200ms ease, filter 200ms ease;
        }
        @keyframes trendChartPillIn {
          from { opacity: 0; transform: translateY(-2px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .trend-chart-scope .trend-chart-pill {
          animation: trendChartPillIn 200ms ease-out;
        }
      `}</style>
      <div className="flex items-center justify-between">
        <span className="text-gray-700 flex items-center gap-1.5" style={{ fontSize: "0.8rem", fontWeight: 600 }}>
          <TrendingUp size={13} className="text-gray-400" />
          แนวโน้มจำนวนบทสนทนาย้อนหลัง
        </span>
        {highlighted >= 0 && data[highlighted] && (
          <span
            key={highlighted}
            className="trend-chart-pill rounded-full px-2.5 py-1 bg-gray-100 text-gray-700"
            style={{ fontSize: "0.72rem", fontWeight: 600 }}
          >
            {data[highlighted].label} · {data[highlighted].count.toLocaleString("th-TH")} บทสนทนา
          </span>
        )}
      </div>

      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>
          <BarChart
            data={data}
            margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
            onMouseMove={(s) => {
              if (s && typeof s.activeTooltipIndex === "number") setActiveIndex(s.activeTooltipIndex);
            }}
            onMouseLeave={() => setActiveIndex(null)}
          >
            <CartesianGrid vertical={false} stroke="#F3F4F6" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "#9CA3AF" }}
              tickLine={false}
              axisLine={{ stroke: "#F3F4F6" }}
              interval="preserveStartEnd"
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 11, fill: "#9CA3AF" }}
              tickLine={false}
              axisLine={false}
              width={28}
            />
            <Tooltip
              cursor={{ fill: "#F9FAFB" }}
              formatter={(value: number) => [`${value.toLocaleString("th-TH")} บทสนทนา`, ""]}
              labelStyle={{ fontSize: "0.75rem", color: "#374151" }}
              contentStyle={{
                fontSize: "0.75rem",
                borderRadius: 8,
                border: "1px solid #F3F4F6",
                boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
              }}
            />
            <Bar dataKey="count" radius={[4, 4, 4, 4]} maxBarSize={28}>
              {data.map((_, i) => (
                <Cell
                  key={i}
                  fill={i === highlighted ? TREND_COLORS.active : TREND_COLORS.inactive}
                  style={{
                    filter: i === highlighted ? "drop-shadow(0 4px 6px rgba(17,24,39,0.35))" : "none",
                    cursor: "pointer",
                  }}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
