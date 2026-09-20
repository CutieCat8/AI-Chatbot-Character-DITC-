import { useEffect, useState } from "react";
import { Search, Plus, Pencil, Trash2, Eye, Loader2, FileText, CircleAlert, ChevronLeft, ChevronRight } from "lucide-react";
import { listDocuments, deleteDocument, type DocumentOut, type SourceSite } from "../../lib/api";
import { getDocumentStatus, DOCUMENT_STATUS_STYLE } from "../../lib/documentStatus";
import { DocumentModal, type DocumentModalMode } from "./DocumentModal";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";

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
  // เปิด DocumentModal (view) ของ id นี้ทันทีจากภายนอก (เช่น กดปุ่มลูกศรใน StatusPanel's
  // "Needs Attention") ไม่ผูกกับตัวกรอง/หน้าปัจจุบันของ grid เลย เพราะ DocumentModal โหลดเอกสารเอง
  // ผ่าน getDocument(id) ตรง ๆ อยู่แล้ว (ดู DocumentModal.tsx) — jumpToId เปลี่ยนค่าทีไรก็เปิดใหม่
  jumpToId?: number | null;
  onJumpHandled?: () => void;
}

export function DocumentsGrid({
  search,
  onSearchChange,
  source: src,
  onSourceChange: setSrc,
  jumpToId,
  onJumpHandled,
}: DocumentsGridProps) {
  const [status, setStatus] = useState<FilterStatus>("all");
  const [page, setPage] = useState(1);
  // "หน้าต่าง" ของปุ่มเลขหน้าที่โชว์อยู่ (เช่น 1-5, 6-10, ...) แยกจาก page จริงที่กำลังดูอยู่ —
  // ผู้ว่าจ้างขอ 2026-09-21 ว่ากด `<`/`>` แล้วอยากให้แค่ "เปลี่ยนชุดปุ่มที่เห็น" ไม่ใช่ "เปลี่ยนหน้า
  // ที่ดูอยู่จริง" ต้องกดเลขหน้าเองถึงจะย้ายไปดูหน้านั้น
  const [pageWindowStart, setPageWindowStart] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);

  const [items, setItems] = useState<DocumentOut[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalMode, setModalMode] = useState<DocumentModalMode | null>(null);
  const [modalDocId, setModalDocId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  // เอกสารที่กำลังรอยืนยันลบ (แทน window.confirm() เดิม — ผู้ว่าจ้างขอ 2026-09-20 ว่า alert เบราว์
  // เซอร์ดีฟอลต์ไม่สวย ให้เปลี่ยนเป็น AlertDialog ที่มีอยู่ในโปรเจกต์นี้แล้ว (shadcn-style))
  const [pendingDelete, setPendingDelete] = useState<DocumentOut | null>(null);

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
    setPageWindowStart(1);
  }, [search, src, status]);

  const openModal = (mode: DocumentModalMode, id: number | null) => {
    setModalMode(mode);
    setModalDocId(id);
  };

  useEffect(() => {
    if (jumpToId == null) return;
    // เปิดเป็น "edit" ไม่ใช่ "view" — คนกดลูกศรจาก Needs Attention ตั้งใจจะมาแก้เนื้อหาให้ยาวพอผ่าน
    // MIN_CHUNK อยู่แล้ว (ดู chunking.py) ไม่ใช่แค่มาดูเฉย ๆ
    setModalMode("edit");
    setModalDocId(jumpToId);
    onJumpHandled?.();
  }, [jumpToId, onJumpHandled]);

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    const doc = pendingDelete;
    setDeletingId(doc.id);
    setPendingDelete(null);
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

  // เดิม slice(0, 5) โชว์แค่หน้า 1-5 ตายตัวเสมอ ไม่มีปุ่มถัดไป/ก่อนหน้า พอเอกสารเกิน 60 รายการ
  // (135 ตอนนี้) หน้า 6 เป็นต้นไปเลยกดเข้าไม่ได้เลยทั้งที่ footer บอก total ถูกต้องอยู่แล้ว
  // (ผู้ว่าจ้างเจอ 2026-09-21) — เปลี่ยนเป็นชุดปุ่ม 5 หน้าต่อชุด (1-5, 6-10, ...) กด `<`/`>` แค่
  // เลื่อนดูชุดถัดไป ไม่เปลี่ยนหน้าที่กำลังดูอยู่ ต้องกดเลขหน้าเองถึงจะย้ายจริง (ผู้ว่าจ้างขอ 2026-09-21)
  const MAX_PAGE_BUTTONS = 5;
  // ชุดสุดท้ายไม่ต้องดันย้อนกลับให้ครบ 5 ปุ่มเสมอ — ถ้าเหลือแค่ 11-12 ก็โชว์แค่นั้น ไม่ใช่ 8-12
  const clampedWindowStart = Math.min(Math.max(1, pageWindowStart), totalPages);
  // ชิดซ้ายเสมอ ช่องที่เหลือ (ชุดสุดท้ายที่ไม่ครบ 5 หน้า) เป็นที่ว่างล่องหนแทน ไม่ดันเลขไปชิดขวา —
  // กันแถบปุ่มความกว้างกระโดดตอนสลับชุดด้วย (ผู้ว่าจ้างขอ 2026-09-21: "< 11 12 _ _ _ >" ไม่ใช่
  // "< _ _ _ 11 12 >")
  const pageSlots: (number | null)[] = Array.from({ length: MAX_PAGE_BUTTONS }, (_, i) => {
    const p = clampedWindowStart + i;
    return p <= totalPages ? p : null;
  });

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
                  {(() => {
                    const s = DOCUMENT_STATUS_STYLE[getDocumentStatus(d)];
                    return (
                      <span className={`flex items-center gap-1 ${s.textClass}`} style={{ fontSize: "0.7rem" }}>
                        <span className={`w-1.5 h-1.5 rounded-full ${s.dotClass}`} />
                        {s.label}
                      </span>
                    );
                  })()}
                  {/* โชว์ id ให้เห็นตรง ๆ บนการ์ด (ผู้ว่าจ้างขอ 2026-09-19) — ไว้ไล่หาเอกสารจากปุ่ม
                      ลูกศรใน StatusPanel's "Needs Attention" ได้ว่ากล่องไหนคือ id อะไรจริง ๆ */}
                  <span className="text-gray-300" style={{ fontSize: "0.66rem" }}>
                    #{d.id}
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
                    onClick={() => setPendingDelete(d)}
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
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setPageWindowStart((w) => Math.max(1, w - MAX_PAGE_BUTTONS))}
            disabled={clampedWindowStart <= 1}
            className="w-7 h-7 rounded-md flex items-center justify-center text-gray-400 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          >
            <ChevronLeft size={14} />
          </button>
          {pageSlots.map((p, i) =>
            p != null ? (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`w-7 h-7 rounded-md transition-colors ${p === page ? "bg-gray-900 text-white" : "text-gray-400 hover:bg-gray-100"}`}
                style={{ fontSize: "0.75rem" }}
              >
                {p}
              </button>
            ) : (
              <span key={`empty-${i}`} className="w-7 h-7" aria-hidden="true" />
            ),
          )}
          <button
            onClick={() => setPageWindowStart((w) => w + MAX_PAGE_BUTTONS)}
            disabled={clampedWindowStart + MAX_PAGE_BUTTONS > totalPages}
            className="w-7 h-7 rounded-md flex items-center justify-center text-gray-400 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          >
            <ChevronRight size={14} />
          </button>
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

      <AlertDialog open={pendingDelete != null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent className="origin-center gap-0 overflow-hidden p-0 data-[state=closed]:slide-out-to-bottom-3 data-[state=closed]:zoom-out-95 data-[state=closed]:duration-150 data-[state=open]:slide-in-from-bottom-3 data-[state=open]:duration-200 sm:max-w-[420px]">
          <AlertDialogHeader className="relative flex-row items-start gap-4 px-5 pb-10 pt-5 text-left">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-gray-200 text-gray-700">
              <CircleAlert size={18} strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
              <AlertDialogTitle className="text-lg">ยืนยันการลบเอกสาร</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="mt-2 space-y-2.5 text-left text-sm leading-5 text-gray-500">
                  <p className="text-[13px]">ต้องการลบเอกสารนี้ใช่ไหม?</p>
                  <div className="flex items-center gap-2.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-gray-800">
                    <FileText size={15} className="shrink-0 text-gray-400" />
                    <span
                      className="min-w-0 truncate text-sm font-medium"
                      title={pendingDelete?.title ?? pendingDelete?.source_url}
                    >
                      {pendingDelete?.title ?? pendingDelete?.source_url ?? "ไม่มีชื่อเอกสาร"}
                    </span>
                  </div>
                </div>
              </AlertDialogDescription>
            </div>
            <p className="absolute bottom-3 right-5 text-right text-xs text-gray-400">
              เมื่อลบแล้วจะไม่สามารถกู้คืนได้
            </p>
          </AlertDialogHeader>
          <AlertDialogFooter className="border-t border-gray-100 bg-gray-50/70 px-5 py-3.5">
            <AlertDialogCancel className="bg-white transition-transform active:scale-95">ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-gray-950 text-white transition-transform hover:bg-gray-800 focus-visible:ring-gray-400 active:scale-95"
            >
              ลบเอกสาร
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
