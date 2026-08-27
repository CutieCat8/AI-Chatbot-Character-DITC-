import { useEffect, useState } from "react";
import { Newspaper, GraduationCap, FilePlus2, ArrowUpRight, type LucideIcon } from "lucide-react";
import { getDocumentStats, type SourceSite } from "../../lib/api";

const CARD_META: Record<SourceSite, { icon: LucideIcon; title: string; sub: string }> = {
  ditc: { icon: Newspaper, title: "DITC", sub: "Strapi scraper" },
  camt: { icon: GraduationCap, title: "CAMT", sub: "HTML scraper" },
  manual: { icon: FilePlus2, title: "Manual", sub: "เพิ่มโดยแอดมิน" },
};

interface CategoryCardsProps {
  selected?: SourceSite | null;
  onSelect?: (source: SourceSite) => void;
}

export function CategoryCards({ selected, onSelect }: CategoryCardsProps) {
  const [counts, setCounts] = useState<Record<SourceSite, number> | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    getDocumentStats()
      .then((stats) => {
        const map = { ditc: 0, camt: 0, manual: 0 } as Record<SourceSite, number>;
        for (const s of stats.by_source) map[s.source_site] = s.count;
        setCounts(map);
      })
      .catch(() => setError(true));
  }, []);

  return (
    <div className="grid grid-cols-3 gap-3">
      {(Object.keys(CARD_META) as SourceSite[]).map((id) => {
        const { icon: Icon, title, sub } = CARD_META[id];
        const count = counts?.[id];
        const isSelected = selected === id;
        return (
          <button
            key={id}
            onClick={() => onSelect?.(id)}
            className={`group text-left bg-white rounded-xl p-5 hover:shadow-sm border transition-all ${
              isSelected ? "border-gray-900 ring-1 ring-gray-900" : "border-gray-100 hover:border-gray-200"
            }`}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center group-hover:bg-gray-900 transition-colors">
                <Icon size={16} className="text-gray-500 group-hover:text-white transition-colors" />
              </div>
              <ArrowUpRight size={14} className="text-gray-300 group-hover:text-gray-600 transition-colors mt-0.5" />
            </div>

            <p className="text-gray-900 mb-0.5" style={{ fontSize: "0.85rem", fontWeight: 600, letterSpacing: "-0.01em" }}>
              {title}
            </p>
            <p className="text-gray-400" style={{ fontSize: "0.72rem" }}>{sub}</p>

            <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
              <span className="text-gray-900" style={{ fontSize: "1.1rem", fontWeight: 700, letterSpacing: "-0.03em" }}>
                {error ? "—" : (count ?? "…")}
              </span>
              <span className="text-gray-400" style={{ fontSize: "0.7rem" }}>รายการ</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
