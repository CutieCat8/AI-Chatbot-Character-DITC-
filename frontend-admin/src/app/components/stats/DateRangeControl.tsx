import { Calendar } from "lucide-react";

export interface DateRangeControlProps {
  start: string; // "YYYY-MM-DD"
  end: string;
  onChange: (start: string, end: string) => void;
}

// preset เป็นแค่ทางลัดของ UI (คำนวณสด ๆ ตอนกด ไม่มีอะไร hardcode ฝั่ง backend เลย — ดู
// routers/stats.py ที่บังคับ start/end ต้องระบุเสมอ ไม่มี default)
const PRESETS: { label: string; days: number }[] = [
  { label: "7 วันล่าสุด", days: 7 },
  { label: "30 วันล่าสุด", days: 30 },
  { label: "90 วันล่าสุด", days: 90 },
];

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function presetRange(days: number): [string, string] {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  return [toISODate(start), toISODate(end)];
}

export function DateRangeControl({ start, end, onChange }: DateRangeControlProps) {
  const activePresetDays = PRESETS.find(({ days }) => {
    const [s, e] = presetRange(days);
    return s === start && e === end;
  })?.days;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 bg-white border border-gray-200 shadow-sm rounded-lg p-1">
        {PRESETS.map(({ label, days }) => (
          <button
            key={days}
            onClick={() => onChange(...presetRange(days))}
            className={`px-2.5 py-1.5 rounded-md transition-colors ${
              activePresetDays === days ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-100"
            }`}
            style={{ fontSize: "0.78rem", fontWeight: activePresetDays === days ? 600 : 400 }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5 bg-white border border-gray-200 shadow-sm rounded-lg px-2.5 py-1.5">
        <Calendar size={13} className="text-gray-400 shrink-0" />
        <input
          type="date"
          value={start}
          max={end}
          onChange={(e) => onChange(e.target.value, end)}
          className="bg-transparent outline-none text-gray-700"
          style={{ fontSize: "0.78rem" }}
        />
        <span className="text-gray-300">–</span>
        <input
          type="date"
          value={end}
          min={start}
          max={toISODate(new Date())}
          onChange={(e) => onChange(start, e.target.value)}
          className="bg-transparent outline-none text-gray-700"
          style={{ fontSize: "0.78rem" }}
        />
      </div>
    </div>
  );
}

export function defaultDateRange(): [string, string] {
  return presetRange(30);
}
