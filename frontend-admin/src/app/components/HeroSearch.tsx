import { useState } from "react";
import { Search } from "lucide-react";

const POPULAR = ["หลักสูตร ANI", "ข่าวล่าสุด", "ติดต่อ DITC", "ปฏิทินกิจกรรม"];

interface HeroSearchProps {
  onSearch?: (q: string) => void;
}

export function HeroSearch({ onSearch }: HeroSearchProps) {
  const [q, setQ] = useState("");

  const submit = (val: string) => {
    setQ(val);
    onSearch?.(val);
  };

  return (
    <div className="bg-white px-8 pt-14 pb-10">
      <div className="max-w-xl mx-auto flex flex-col items-center gap-5">
        <div className="text-center">
          <h1
            className="text-gray-900"
            style={{ fontSize: "1.65rem", fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1.2 }}
          >
            มีอะไรให้ช่วยวันนี้?
          </h1>
          <p className="text-gray-400 mt-2" style={{ fontSize: "0.875rem" }}>
            ค้นหาเอกสาร ข่าวสาร โครงการ และหลักสูตรทั้งหมด
          </p>
        </div>

        {/* Search */}
        <div className="w-full flex items-center border border-gray-200 rounded-lg bg-gray-50 overflow-hidden focus-within:bg-white focus-within:border-gray-400 focus-within:ring-2 focus-within:ring-gray-100 transition-all">
          <Search size={15} className="ml-3.5 text-gray-400 shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit(q)}
            placeholder="ค้นหาเอกสาร, หัวข้อ, หมวดหมู่..."
            className="flex-1 px-3 py-2.5 bg-transparent outline-none text-gray-800 placeholder-gray-400"
            style={{ fontSize: "0.875rem" }}
          />
          <button
            onClick={() => submit(q)}
            className="m-1 px-4 py-1.5 bg-gray-900 hover:bg-gray-700 text-white rounded-md transition-colors"
            style={{ fontSize: "0.8rem", fontWeight: 500 }}
          >
            ค้นหา
          </button>
        </div>

        {/* Popular */}
        <div className="flex items-center gap-1 flex-wrap justify-center">
          <span className="text-gray-300 mr-1" style={{ fontSize: "0.75rem" }}>ค้นหาบ่อย</span>
          {POPULAR.map((t) => (
            <button
              key={t}
              onClick={() => submit(t)}
              className="px-2.5 py-0.5 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-800 transition-colors"
              style={{ fontSize: "0.73rem" }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
