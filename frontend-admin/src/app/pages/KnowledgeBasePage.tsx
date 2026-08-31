import { useState } from "react";
import { CategoryNav } from "../components/CategoryNav";
import { StatusPanel } from "../components/StatusPanel";
import { DocumentsGrid, type FilterSource } from "../components/DocumentsGrid";
import type { SourceSite } from "../../lib/api";

export default function KnowledgeBasePage() {
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<FilterSource>("all");

  const handleSelectCategory = (s: SourceSite | null) => {
    setSource(s ?? "all");
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-screen-xl mx-auto w-full px-8 py-10">
        <h1 className="text-gray-900" style={{ fontSize: "1.75rem", fontWeight: 700, letterSpacing: "-0.03em" }}>
          Knowledge Base
        </h1>
        <p className="text-gray-400 mt-1.5" style={{ fontSize: "0.85rem" }}>
          จัดการฐานความรู้ที่ใช้ตอบคำถามในระบบ RAG — เนื้อหาจาก DITC, CAMT และที่แอดมินเพิ่มเอง
        </p>

        <div className="flex gap-6 mt-8 items-start">
          {/* Left: navigation + status */}
          <div className="w-60 shrink-0 flex flex-col gap-6">
            <CategoryNav selected={source === "all" ? null : source} onSelect={handleSelectCategory} />
            <StatusPanel />
          </div>

          {/* Right: resources */}
          <div className="flex-1 min-w-0">
            <p className="text-gray-400 mb-3" style={{ fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Resources
            </p>
            <DocumentsGrid search={search} onSearchChange={setSearch} source={source} onSourceChange={setSource} />
          </div>
        </div>
      </div>
    </div>
  );
}
