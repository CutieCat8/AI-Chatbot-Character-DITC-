import { useEffect, useState } from "react";
import { Search, Plus, Pencil, Trash2, Eye, Loader2, FileText } from "lucide-react";
import { listDocuments, deleteDocument, type DocumentOut, type SourceSite } from "../../lib/api";
import { DocumentModal, type DocumentModalMode } from "./DocumentModal";

const SRC_STYLE: Record<SourceSite, string> = {
  ditc: "bg-gray-800 text-gray-50",
  camt: "bg-gray-200 text-gray-700",
  manual: "bg-white text-gray-400 border border-gray-200",
};

const SRC_LABEL: Record<SourceSite, string> = {
  ditc: "DITC",
  camt: "CAMT",
  manual: "Manual",
};

export type FilterSource = "all" | SourceSite;
type FilterStatus = "all" | "active" | "inactive";

const PAGE_SIZE = 12;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
}

function urlPreview(doc: DocumentOut): string {
  if (doc.source_site === "manual") return "เพิ่มโดยแอดมิน";
  try {
    const u = new URL(doc.source_url);
    const decodedPath = decodeURIComponent(u.pathname);
    const path = decodedPath === "/" ? "/" : `${decodedPath.slice(0, 28)}${decodedPath.length > 28 ? "…" : ""}`;
    return `${u.hostname}${path}`;
  } catch {
    return doc.source_url;
  }
}

interface DocumentsGridProps {
  search: string;
  onSearchChange: (q: string) => void;
  source: FilterSource;
  onSourceChange: (s: FilterSource) => void;
}

export function DocumentsGrid({ search, onSearchChange, source: src, onSourceChange: setSrc }: DocumentsGridProps) {
  const [status, setStatus] = useState<FilterStatus>("all");
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);

  const [items, setItems] = useState<DocumentOut[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalMode, setModalMode] = useState<DocumentModalMode | null>(null);
  const [modalDocId, setModalDocId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    listDocuments({
      source: src === "all" ? undefined : src,
      is_active: status === "all" ? undefined : status === "active",
      search: search || undefined,
      page,
      page_size: PAGE_SIZE,
    })
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setTotal(res.total);
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
  }, [search, src, status, page, refreshKey]);

  // เปลี่ยนตัวกรอง → กลับไปหน้าแรก
  useEffect(() => {
    setPage(1);
  }, [search, src, status]);

  const openModal = (mode: DocumentModalMode, id: number | null) => {
    setModalMode(mode);
    setModalDocId(id);
  };

  const handleDelete = async (doc: DocumentOut) => {
    const ok = window.confirm(`ลบเอกสาร "${doc.title ?? doc.source_url}" ใช่ไหม? กู้คืนไม่ได้`);
    if (!ok) return;

    setDeletingId(doc.id);
    try {
      await deleteDocument(doc.id);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      window.alert(`ลบไม่สำเร็จ: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setDeletingId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="flex items-center bg-white border border-gray-200 shadow-sm rounded-lg px-2.5 gap-1.5 focus-within:border-gray-400 transition-colors flex-1 max-w-sm">
          <Search size={13} className="text-gray-400 shrink-0" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="ค้นหาเอกสาร, หัวข้อ..."
            className="py-2 bg-transparent outline-none text-gray-700 placeholder-gray-300 w-full"
            style={{ fontSize: "0.8rem" }}
          />
        </div>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as FilterStatus)}
          className="px-2.5 py-2 text-gray-500 bg-white border border-gray-200 shadow-sm rounded-lg outline-none hover:border-gray-300 transition-colors cursor-pointer"
          style={{ fontSize: "0.78rem" }}
        >
          <option value="all">สถานะ: ทั้งหมด</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>

        {src !== "all" && (
          <button
            onClick={() => setSrc("all")}
            className="px-2.5 py-2 text-gray-400 hover:text-gray-700 transition-colors"
            style={{ fontSize: "0.75rem" }}
          >
            ล้างตัวกรองแหล่งที่มา ✕
          </button>
        )}

        <div className="flex-1" />

        <button
          onClick={() => openModal("create", null)}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-gray-900 hover:bg-gray-700 text-white rounded-lg transition-colors shrink-0"
        >
          <Plus size={13} />
          <span style={{ fontSize: "0.78rem", fontWeight: 500 }}>Add Entry</span>
        </button>
      </div>

      {/* Grid */}
      {loading && (
        <div className="py-16 text-center text-gray-300" style={{ fontSize: "0.85rem" }}>กำลังโหลด...</div>
      )}
      {!loading && error && (
        <div className="py-16 text-center text-red-400" style={{ fontSize: "0.85rem" }}>เชื่อมต่อ API ไม่สำเร็จ: {error}</div>
      )}
      {!loading && !error && items.length === 0 && (
        <div className="py-16 text-center text-gray-300" style={{ fontSize: "0.85rem" }}>ไม่พบรายการ</div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
          {items.map((d) => (
            <div
              key={d.id}
              className="group relative bg-white rounded-xl border border-gray-100 shadow-sm hover:border-gray-300 hover:shadow-md hover:-translate-y-0.5 transition-all p-4 flex flex-col gap-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded font-semibold ${SRC_STYLE[d.source_site]}`} style={{ fontSize: "0.66rem" }}>
                    {SRC_LABEL[d.source_site]}
                  </span>
                  <span className={`flex items-center gap-1 ${d.is_active ? "text-gray-500" : "text-amber-600"}`} style={{ fontSize: "0.7rem" }}>
                    <span className={`w-1.5 h-1.5 rounded-full ${d.is_active ? "bg-emerald-500" : "bg-amber-400"}`} />
                    {d.is_active ? "Active" : "Inactive"}
                  </span>
                </div>

                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => openModal("view", d.id)}
                    className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    <Eye size={13} />
                  </button>
                  <button
                    onClick={() => openModal("edit", d.id)}
                    className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => handleDelete(d)}
                    disabled={deletingId === d.id}
                    className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                  >
                    {deletingId === d.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  </button>
                </div>
              </div>

              <button onClick={() => openModal("view", d.id)} className="text-left flex-1 min-w-0 flex flex-col gap-1.5">
                <div className="flex items-start gap-2">
                  <FileText size={14} className="text-gray-300 mt-0.5 shrink-0" />
                  <span className="text-gray-800 line-clamp-2" style={{ fontSize: "0.85rem", fontWeight: 500 }}>
                    {d.title ?? d.source_url}
                  </span>
                </div>
                <span className="text-gray-400 truncate pl-[1.375rem]" style={{ fontSize: "0.73rem" }}>
                  {urlPreview(d)}
                </span>
              </button>

              <div className="flex items-center justify-between pt-2.5 border-t border-gray-50" style={{ fontSize: "0.72rem" }}>
                <span className="text-gray-400">{d.chunk_count.toLocaleString()} chunks</span>
                <span className="text-gray-300">{formatDate(d.updated_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1">
        <span className="text-gray-300" style={{ fontSize: "0.73rem" }}>
          {items.length ? (page - 1) * PAGE_SIZE + 1 : 0}–{(page - 1) * PAGE_SIZE + items.length} / {total} รายการ
        </span>
        <div className="flex gap-0.5">
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .slice(0, 5)
            .map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`w-7 h-7 rounded-md transition-colors ${p === page ? "bg-gray-900 text-white" : "text-gray-400 hover:bg-gray-100"}`}
                style={{ fontSize: "0.75rem" }}
              >
                {p}
              </button>
            ))}
        </div>
      </div>

      {modalMode && (
        <DocumentModal
          mode={modalMode}
          documentId={modalDocId}
          open={modalMode !== null}
          onOpenChange={(open) => {
            if (!open) setModalMode(null);
          }}
          onSaved={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
