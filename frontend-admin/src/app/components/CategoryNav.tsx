import { useEffect, useState } from "react";
import { LayoutGrid, Newspaper, GraduationCap, FilePlus2, type LucideIcon } from "lucide-react";
import { getDocumentStats, type SourceSite } from "../../lib/api";

const CARD_META: Record<SourceSite, { icon: LucideIcon; title: string }> = {
  ditc: { icon: Newspaper, title: "DITC" },
  camt: { icon: GraduationCap, title: "CAMT" },
  manual: { icon: FilePlus2, title: "Manual" },
};

interface CategoryNavProps {
  selected: SourceSite | null;
  onSelect: (source: SourceSite | null) => void;
}

export function CategoryNav({ selected, onSelect }: CategoryNavProps) {
  const [counts, setCounts] = useState<Record<SourceSite, number> | null>(null);
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    getDocumentStats()
      .then((stats) => {
        const map = { ditc: 0, camt: 0, manual: 0 } as Record<SourceSite, number>;
        for (const s of stats.by_source) map[s.source_site] = s.count;
        setCounts(map);
        setTotal(stats.total);
      })
      .catch(() => {});
  }, []);

  const items: { id: SourceSite | null; icon: LucideIcon; title: string; count: number | null }[] = [
    { id: null, icon: LayoutGrid, title: "ทั้งหมด", count: total },
    ...(Object.keys(CARD_META) as SourceSite[]).map((id) => ({
      id,
      icon: CARD_META[id].icon,
      title: CARD_META[id].title,
      count: counts?.[id] ?? null,
    })),
  ];

  return (
    <div className="flex flex-col gap-2">
      <p className="text-gray-400 px-1" style={{ fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        Navigation
      </p>
      {items.map(({ id, icon: Icon, title, count }) => {
        const isSelected = selected === id;
        return (
          <button
            key={title}
            onClick={() => onSelect(id)}
            className={`text-left bg-white rounded-lg border p-3 flex flex-col gap-1 transition-all shadow-sm ${
              isSelected ? "border-gray-900 ring-1 ring-gray-900 shadow-md" : "border-gray-100 hover:border-gray-300 hover:shadow-md"
            }`}
          >
            <span className="flex items-center gap-2 text-gray-800" style={{ fontSize: "0.83rem", fontWeight: 500 }}>
              <Icon size={14} className="text-gray-500 shrink-0" />
              {title}
            </span>
            <span className="text-gray-400 pl-[1.375rem]" style={{ fontSize: "0.72rem" }}>
              Total: {count ?? "…"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
