import { useRef, useState } from "react";
import { HeroSearch } from "../components/HeroSearch";
import { CategoryCards } from "../components/CategoryCards";
import { DocumentsTable, type FilterSource } from "../components/DocumentsTable";
import { RightSidebar } from "../components/RightSidebar";
import type { SourceSite } from "../../lib/api";

export default function KnowledgeBasePage() {
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<FilterSource>("all");
  const tableRef = useRef<HTMLDivElement>(null);

  const scrollToTable = () => {
    tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleHeroSearch = (q: string) => {
    setSearch(q);
    scrollToTable();
  };

  const handleSelectCategory = (s: SourceSite) => {
    setSource((prev) => (prev === s ? "all" : s)); // กดซ้ำ = เลิกกรอง
    scrollToTable();
  };

  return (
    <>
      <HeroSearch onSearch={handleHeroSearch} />

      {/* Divider */}
      <div className="border-b border-gray-100" />

      {/* Body */}
      <div className="flex-1 flex gap-5 px-8 py-7 max-w-screen-xl mx-auto w-full">
        {/* Main */}
        <div className="flex-1 flex flex-col gap-6 min-w-0">
          {/* Section: categories */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-gray-800" style={{ fontSize: "0.82rem", fontWeight: 600 }}>หมวดหมู่</p>
              <p className="text-gray-300" style={{ fontSize: "0.73rem" }}>3 แหล่งข้อมูล · อัปเดตอัตโนมัติ</p>
            </div>
            <CategoryCards
              selected={source === "all" ? null : source}
              onSelect={handleSelectCategory}
            />
          </div>

          {/* Section: documents */}
          <div ref={tableRef}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-gray-800" style={{ fontSize: "0.82rem", fontWeight: 600 }}>เอกสารทั้งหมด</p>
            </div>
            <DocumentsTable
              search={search}
              onSearchChange={setSearch}
              source={source}
              onSourceChange={setSource}
            />
          </div>
        </div>

        {/* Sidebar */}
        <RightSidebar />
      </div>
    </>
  );
}
