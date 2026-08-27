import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog";
import {
  getDocument,
  createDocument,
  updateDocument,
  type DocumentDetailOut,
} from "../../lib/api";

export type DocumentModalMode = "view" | "edit" | "create";

interface DocumentModalProps {
  mode: DocumentModalMode;
  documentId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

const SRC_LABEL: Record<string, string> = { ditc: "DITC", camt: "CAMT", manual: "Manual" };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

export function DocumentModal({ mode, documentId, open, onOpenChange, onSaved }: DocumentModalProps) {
  const [doc, setDoc] = useState<DocumentDetailOut | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isActive, setIsActive] = useState(true);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isView = mode === "view";
  const isEdit = mode === "edit";

  useEffect(() => {
    if (!open) return;

    setError(null);
    if (mode === "create") {
      setDoc(null);
      setTitle("");
      setContent("");
      setIsActive(true);
      return;
    }

    if (documentId == null) return;
    setLoading(true);
    getDocument(documentId)
      .then((d) => {
        setDoc(d);
        setTitle(d.title ?? "");
        setContent(d.content);
        setIsActive(d.is_active);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, [open, mode, documentId]);

  const handleSave = async () => {
    if (!content.trim()) {
      setError("กรอกเนื้อหาก่อนบันทึก");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (mode === "create") {
        await createDocument({ title: title || null, content });
      } else if (mode === "edit" && documentId != null) {
        await updateDocument(documentId, { title: title || null, content, is_active: isActive });
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "เพิ่มเอกสารใหม่" : mode === "edit" ? "แก้ไขเอกสาร" : "รายละเอียดเอกสาร"}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-12 flex items-center justify-center text-gray-400">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto flex flex-col gap-4 px-1">
            {doc && (
              <div className="flex flex-wrap items-center gap-3 text-gray-400" style={{ fontSize: "0.72rem" }}>
                <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 font-semibold">
                  {SRC_LABEL[doc.source_site] ?? doc.source_site}
                </span>
                <span>Chunks: {doc.chunk_count}</span>
                <span>อัปเดต: {formatDate(doc.updated_at)}</span>
                {doc.source_site !== "manual" && (
                  <a
                    href={doc.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sky-500 hover:underline truncate max-w-xs"
                  >
                    {doc.source_url}
                  </a>
                )}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-gray-500" style={{ fontSize: "0.75rem", fontWeight: 500 }}>ชื่อเรื่อง</label>
              {isView ? (
                <p className="text-gray-800" style={{ fontSize: "0.9rem" }}>{title || "—"}</p>
              ) : (
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="ชื่อเอกสาร (ไม่บังคับ)"
                  className="px-3 py-2 border border-gray-200 rounded-lg outline-none focus:border-gray-400 transition-colors"
                  style={{ fontSize: "0.85rem" }}
                />
              )}
            </div>

            <div className="flex flex-col gap-1.5 flex-1 min-h-0">
              <label className="text-gray-500" style={{ fontSize: "0.75rem", fontWeight: 500 }}>เนื้อหา</label>
              {isView ? (
                <p className="text-gray-700 whitespace-pre-wrap" style={{ fontSize: "0.85rem", lineHeight: 1.7 }}>
                  {content}
                </p>
              ) : (
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="เนื้อหาเอกสาร..."
                  rows={10}
                  className="px-3 py-2 border border-gray-200 rounded-lg outline-none focus:border-gray-400 transition-colors resize-y"
                  style={{ fontSize: "0.85rem", lineHeight: 1.6 }}
                />
              )}
            </div>

            {isEdit && (
              <label className="flex items-center gap-2 cursor-pointer w-fit">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                <span className="text-gray-600" style={{ fontSize: "0.82rem" }}>Active (แสดงในระบบค้นหา)</span>
              </label>
            )}

            {error && <p className="text-red-500" style={{ fontSize: "0.8rem" }}>{error}</p>}
          </div>
        )}

        {!isView && (
          <DialogFooter>
            <button
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="px-4 py-2 text-gray-500 hover:text-gray-800 transition-colors"
              style={{ fontSize: "0.82rem" }}
            >
              ยกเลิก
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loading}
              className="px-4 py-2 bg-gray-900 hover:bg-gray-700 disabled:opacity-40 text-white rounded-lg transition-colors flex items-center gap-1.5"
              style={{ fontSize: "0.82rem", fontWeight: 500 }}
            >
              {saving && <Loader2 size={13} className="animate-spin" />}
              {mode === "create" ? "เพิ่มเอกสาร" : "บันทึก"}
            </button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
