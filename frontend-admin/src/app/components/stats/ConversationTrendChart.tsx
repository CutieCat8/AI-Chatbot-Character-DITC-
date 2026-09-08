import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TrendingUp } from "lucide-react";
import type { DailyConversationCountOut } from "../../../lib/api";

interface ConversationTrendChartProps {
  dailyCounts: DailyConversationCountOut[];
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short" });
}

export function ConversationTrendChart({ dailyCounts }: ConversationTrendChartProps) {
  const data = dailyCounts.map((d) => ({ ...d, label: formatDay(d.date) }));

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3">
      <span className="text-gray-700 flex items-center gap-1.5" style={{ fontSize: "0.8rem", fontWeight: 600 }}>
        <TrendingUp size={13} className="text-gray-400" />
        แนวโน้มจำนวนบทสนทนาย้อนหลัง
      </span>

      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id="conversationTrendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#111827" stopOpacity={0.18} />
                <stop offset="100%" stopColor="#111827" stopOpacity={0} />
              </linearGradient>
            </defs>
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
              formatter={(value: number) => [`${value.toLocaleString("th-TH")} บทสนทนา`, ""]}
              labelStyle={{ fontSize: "0.75rem", color: "#374151" }}
              contentStyle={{
                fontSize: "0.75rem",
                borderRadius: 8,
                border: "1px solid #F3F4F6",
                boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
              }}
            />
            <Area
              type="monotone"
              dataKey="count"
              stroke="#111827"
              strokeWidth={1.75}
              fill="url(#conversationTrendFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
