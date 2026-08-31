import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
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
import { tidyScrapedText } from "../../lib/textClean";

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

function MetaField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-gray-400" style={{ fontSize: "0.68rem", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>
        {label}
      </span>
      <div className="text-gray-800" style={{ fontSize: "0.82rem" }}>
        {children}
      </div>
    </div>
  );
}

export function DocumentModal({ mode, documentId, open, onOpenChange, onSaved }: DocumentModalProps) {
  const [doc, setDoc] = useState<DocumentDetailOut | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [showRaw, setShowRaw] = useState(false);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isView = mode === "view";
  const isEdit = mode === "edit";

  useEffect(() => {
    if (!open) return;

    setError(null);
    setShowRaw(false);
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

  const cleanedContent = useMemo(() => tidyScrapedText(content), [content]);
  const removedLineCount = useMemo(() => {
    const before = content.split(/\r?\n/).length;
    const after = cleanedContent.split(/\r?\n/).length;
    return Math.max(0, before - after);
  }, [content, cleanedContent]);

  const handleTidy = () => setContent(cleanedContent);

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
      <DialogContent className="sm:max-w-3xl max-h-[88vh] flex flex-col">
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
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-lg bg-gray-50 border border-gray-100">
                <MetaField label="Source">{SRC_LABEL[doc.source_site] ?? doc.source_site}</MetaField>
                <MetaField label="Status">
                  <span className={`flex items-center gap-1.5 ${doc.is_active ? "text-gray-500" : "text-amber-600"}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${doc.is_active ? "bg-emerald-500" : "bg-amber-400"}`} />
                    {doc.is_active ? "Active" : "Inactive"}
                  </span>
                </MetaField>
                <MetaField label="อัปเดต">{formatDate(doc.updated_at)}</MetaField>
                <MetaField label="Chunks">{doc.chunk_count.toLocaleString()}</MetaField>
                {doc.source_site !== "manual" && (
                  <div className="col-span-2 sm:col-span-4">
                    <MetaField label="Source URL">
                      <a
                        href={doc.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sky-500 hover:underline break-all"
                        style={{ fontSize: "0.78rem" }}
                      >
                        {doc.source_url}
                      </a>
                    </MetaField>
                  </div>
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
              <div className="flex items-center justify-between">
                <label className="text-gray-500" style={{ fontSize: "0.75rem", fontWeight: 500 }}>เนื้อหา</label>

                {isView && removedLineCount > 0 && (
                  <button
                    onClick={() => setShowRaw((v) => !v)}
                    className="text-gray-400 hover:text-gray-700 transition-colors underline"
                    style={{ fontSize: "0.72rem" }}
                  >
                    {showRaw ? "ดูฉบับตัดซ้ำ" : `ดูต้นฉบับ (มีบรรทัดซ้ำ ${removedLineCount} บรรทัด)`}
                  </button>
                )}

                {!isView && removedLineCount > 0 && (
                  <button
                    onClick={handleTidy}
                    className="flex items-center gap-1 text-violet-600 hover:text-violet-800 transition-colors"
                    style={{ fontSize: "0.72rem", fontWeight: 500 }}
                  >
                    <Sparkles size={12} />
                    จัดระเบียบข้อความ (ตัดซ้ำ {removedLineCount} บรรทัด)
                  </button>
                )}
              </div>

              {isView ? (
                <p className="text-gray-700 whitespace-pre-wrap" style={{ fontSize: "0.85rem", lineHeight: 1.75 }}>
                  {showRaw ? content : cleanedContent}
                </p>
              ) : (
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="เนื้อหาเอกสาร..."
                  rows={16}
                  className="px-3 py-2.5 border border-gray-200 rounded-lg outline-none focus:border-gray-400 transition-colors resize-y"
                  style={{ fontSize: "0.85rem", lineHeight: 1.7 }}
                />
              )}

              {!isView && (
                <p className="text-gray-400" style={{ fontSize: "0.7rem" }}>
                  "จัดระเบียบข้อความ" จะตัดเฉพาะบรรทัด/บล็อกที่ซ้ำติดกัน (เช่นเมนูที่ถูกดึงมาซ้ำ) — ไม่ตัดหัวข้อที่ตั้งใจซ้ำในแต่ละหมวด กดแล้วยังแก้ไขต่อได้ก่อนบันทึก
                </p>
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
