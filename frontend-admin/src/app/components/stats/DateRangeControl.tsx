import { useEffect, useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Calendar } from "../ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// สร้าง Date เที่ยงคืนตามเวลาเครื่อง จาก "YYYY-MM-DD" ตรง ๆ — ไม่ใช้ new Date(iso) เพราะ browser จะ
// ตีความ iso ล้วน ๆ (ไม่มี time) เป็น UTC เที่ยงคืน แล้ว toLocaleDateString/getDate ในโซนเวลาไทย (+7)
// อาจเลื่อนวันไปเป็นวันก่อนหน้า
function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// แสดงแบบ DD/MM/YYYY (ปี ค.ศ.) ตามที่ผู้ว่าจ้างขอไว้ตอนแก้ StatusPanel.tsx (2026-09-19) — ธีมเดียวกัน
// ทั้งแอป ไม่ใช้ toLocaleDateString("th-TH") เพราะคืนปี พ.ศ.
function formatDisplay(iso: string): string {
  const d = parseISODate(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${d.getFullYear()}`;
}

function presetRange(days: number): [string, string] {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  return [toISODate(start), toISODate(end)];
}

export function DateRangeControl({ start, end, onChange }: DateRangeControlProps) {
  const [open, setOpen] = useState(false);
  // ค่าที่กำลังเลือกอยู่ในปฏิทิน (ไม่ยิง onChange ออกไปจนกว่าจะครบทั้งวันเริ่ม-สิ้นสุด) แยกจาก
  // start/end ที่มาจาก parent เพราะกดวันแรกแล้วยังไม่อยากให้กราฟหน้าอื่นรีเฟรชทันที
  const [pending, setPending] = useState<DateRange | undefined>(() => ({
    from: parseISODate(start),
    to: parseISODate(end),
  }));

  useEffect(() => {
    setPending({ from: parseISODate(start), to: parseISODate(end) });
  }, [start, end]);

  const activePresetDays = PRESETS.find(({ days }) => {
    const [s, e] = presetRange(days);
    return s === start && e === end;
  })?.days;

  const handleSelect = (range: DateRange | undefined) => {
    setPending(range);
    if (range?.from && range?.to) {
      onChange(toISODate(range.from), toISODate(range.to));
      setOpen(false);
    }
  };

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

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className="flex items-center gap-1.5 bg-white border border-gray-200 shadow-sm rounded-lg px-2.5 py-1.5 hover:border-gray-300 transition-colors"
            style={{ fontSize: "0.78rem" }}
          >
            <CalendarIcon size={13} className="text-gray-400 shrink-0" />
            <span className="text-gray-700">{formatDisplay(start)}</span>
            <span className="text-gray-300">–</span>
            <span className="text-gray-700">{formatDisplay(end)}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="range"
            defaultMonth={pending?.from ?? parseISODate(start)}
            selected={pending}
            onSelect={handleSelect}
            numberOfMonths={1}
            disabled={{ after: new Date() }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function defaultDateRange(): [string, string] {
  return presetRange(7);
}
