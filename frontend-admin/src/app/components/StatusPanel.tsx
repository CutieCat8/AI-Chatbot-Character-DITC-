import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, AlertTriangle, Database, ArrowUpRight, CheckCircle2 } from "lucide-react";
import { getDocumentStats, getSyncStatus, listDocuments, triggerSync, type DocumentOut } from "../../lib/api";

interface StatusPanelProps {
  // เปิด DocumentModal (view) ของเอกสารตัวนี้ — ยกสถานะ modal ขึ้นไปไว้ที่ DocumentsGrid.tsx ผ่าน
  // KnowledgeBasePage.tsx เพราะ DocumentModal ผูกอยู่กับ DocumentsGrid ไม่ใช่ StatusPanel เอง
  onJumpToDocument?: (id: number) => void;
}

// เดิมโชว์แค่เวลา (เช่น "14:32 น.") ไม่มีวันที่ ใช้บอกไม่ได้ว่า sync ล่าสุดคือ "วันนี้" หรือค้างมา
// หลายวันแล้ว — เปลี่ยนเป็นวันที่ DD/MM/YYYY ตามที่ผู้ว่าจ้างขอ (เขียนเองแทน toLocaleDateString
// เพราะ locale "th-TH" คืนปี พ.ศ. เช่น 2569 ซึ่งไม่ตรงกับตัวอย่างที่ขอ "19/09/2026" ที่เป็น ค.ศ.)
function formatDate(iso: string | null): string {
  if (!iso) return "ยังไม่เคย sync";
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${d.getFullYear()}`;
}

export function StatusPanel({ onJumpToDocument }: StatusPanelProps) {
  const [ditcDocs, setDitcDocs] = useState(0);
  const [camtDocs, setCamtDocs] = useState(0);
  const [total, setTotal] = useState(0);

  const [isRunning, setIsRunning] = useState(false);
  const [todayCount, setTodayCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [needsAttention, setNeedsAttention] = useState(0);
  // รายชื่อจริงของเอกสารที่ยังไม่ index (ไม่ใช่แค่ตัวเลขนับเฉย ๆ แบบเดิม) — ผู้ว่าจ้างขอให้กล่องนี้
  // ทำตัวเหมือนกล่อง log/error แทน ต้องรู้ทันทีว่า "ตัวไหน" ไม่ใช่แค่ "กี่ตัว" backend มี filter
  // ?unindexed=true เตรียมไว้อยู่แล้ว (ดู routers/documents.py) แค่ยังไม่มีใครเรียกใช้จาก UI มาก่อน
  const [unindexedDocs, setUnindexedDocs] = useState<DocumentOut[]>([]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadStats = useCallback(() => {
    getDocumentStats()
      .then((stats) => {
        setTotal(stats.total);
        setDitcDocs(stats.by_source.find((s) => s.source_site === "ditc")?.count ?? 0);
        setCamtDocs(stats.by_source.find((s) => s.source_site === "camt")?.count ?? 0);
      })
      .catch(() => {});
  }, []);

  const loadUnindexedDocs = useCallback(() => {
    listDocuments({ unindexed: true, page_size: 20 })
      .then((res) => setUnindexedDocs(res.items))
      .catch(() => {});
  }, []);

  const loadSyncStatus = useCallback(() => {
    getSyncStatus()
      .then((status) => {
        setIsRunning(status.is_running);
        setTodayCount(status.today_count);
        setLastSyncedAt(status.last_synced_at);
        setNeedsAttention(status.needs_attention_count);
        return status.is_running;
      })
      .catch(() => false);
    loadUnindexedDocs();
  }, [loadUnindexedDocs]);

  useEffect(() => {
    loadStats();
    loadSyncStatus();
  }, [loadStats, loadSyncStatus]);

  // ตอน sync กำลังรันอยู่ (กดเอง หรือมีคนอื่นสั่งไว้) → poll ทุก 3 วิ จนกว่าจะเสร็จ แล้วรีเฟรชสถิติ
  useEffect(() => {
    if (isRunning && !pollRef.current) {
      pollRef.current = setInterval(async () => {
        const status = await getSyncStatus().catch(() => null);
        if (!status) return;
        setTodayCount(status.today_count);
        setLastSyncedAt(status.last_synced_at);
        setNeedsAttention(status.needs_attention_count);
        if (!status.is_running) {
          setIsRunning(false);
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          loadStats();
          loadUnindexedDocs();
        }
      }, 3000);
    }
    return () => {
      if (!isRunning && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [isRunning, loadStats, loadUnindexedDocs]);

  const handleSyncNow = () => {
    if (isRunning) return;
    setIsRunning(true);
    triggerSync().catch(() => setIsRunning(false));
  };

  const ditcPct = total ? Math.round((ditcDocs / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Sync */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-gray-700 flex items-center gap-1.5" style={{ fontSize: "0.8rem", fontWeight: 600 }}>
            <RefreshCw size={13} className="text-gray-400" />
            Sync
          </span>
          <span className={`flex items-center gap-1 ${isRunning ? "text-sky-500" : "text-gray-500"}`} style={{ fontSize: "0.68rem" }}>
            <span className={`w-1.5 h-1.5 rounded-full inline-block ${isRunning ? "bg-sky-400 animate-pulse" : "bg-emerald-500"}`} />
            {isRunning ? "Syncing…" : "Live"}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <span className="text-gray-400" style={{ fontSize: "0.73rem" }}>วันนี้</span>
            <span className="text-gray-800" style={{ fontSize: "0.8rem", fontWeight: 600 }}>+{todayCount} รายการ</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-400" style={{ fontSize: "0.73rem" }}>ล่าสุด</span>
            <span className="text-gray-500" style={{ fontSize: "0.7rem" }}>{formatDate(lastSyncedAt)}</span>
          </div>
        </div>

        <button
          onClick={handleSyncNow}
          disabled={isRunning}
          className="w-full py-2 bg-gray-900 hover:bg-gray-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center justify-center gap-1.5"
        >
          <RefreshCw size={11} className={isRunning ? "animate-spin" : ""} />
          <span style={{ fontSize: "0.75rem", fontWeight: 500 }}>{isRunning ? "กำลัง Sync..." : "Sync Now"}</span>
        </button>
      </div>

      {/* Attention — ทำตัวเหมือนกล่อง log/error แทนที่จะโชว์แค่ตัวเลขนับเฉย ๆ (ผู้ว่าจ้างขอ
          2026-09-19): บอก "ตัวไหน" ไม่ใช่แค่ "กี่ตัว" แต่ละแถวกดปุ่มลูกศรเพื่อเปิด DocumentModal ของ
          เอกสารตัวนั้นตรง ๆ ได้เลย ไม่ต้องไปงมหาเองในหน้า Resources */}
      <div className={`bg-white rounded-xl border shadow-sm p-4 flex flex-col gap-2.5 ${needsAttention > 0 ? "border-amber-100" : "border-gray-100"}`}>
        <span className="text-gray-700 flex items-center gap-1.5" style={{ fontSize: "0.8rem", fontWeight: 600 }}>
          <AlertTriangle size={13} className={needsAttention > 0 ? "text-amber-400" : "text-gray-300"} />
          Needs Attention
          {needsAttention > 0 && (
            <span className="text-amber-600" style={{ fontWeight: 700 }}>
              ({needsAttention})
            </span>
          )}
        </span>

        {needsAttention === 0 ? (
          <div className="flex items-center gap-1.5 text-gray-400 px-1 py-1" style={{ fontSize: "0.72rem" }}>
            <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
            ไม่มีเอกสารที่ต้องดูแล
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <p className="text-amber-600" style={{ fontSize: "0.68rem", fontWeight: 600 }}>
              ยังไม่ได้ index
            </p>
            {unindexedDocs.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between gap-2 bg-amber-50 rounded-lg px-2.5 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-amber-700 shrink-0" style={{ fontSize: "0.72rem", fontWeight: 700 }}>
                    #{doc.id}
                  </span>{" "}
                  <span className="text-amber-600 truncate" style={{ fontSize: "0.7rem" }} title={doc.title ?? undefined}>
                    {doc.title || "(ไม่มีชื่อเรื่อง)"}
                  </span>
                </div>
                <button
                  onClick={() => onJumpToDocument?.(doc.id)}
                  className="shrink-0 w-5 h-5 rounded-md flex items-center justify-center text-amber-500 hover:bg-amber-100 hover:text-amber-700 transition-colors"
                  title="แก้ไขเอกสารนี้"
                >
                  <ArrowUpRight size={13} />
                </button>
              </div>
            ))}
            {needsAttention > unindexedDocs.length && (
              <p className="text-amber-500 text-center" style={{ fontSize: "0.66rem" }}>
                และอีก {needsAttention - unindexedDocs.length} รายการ
              </p>
            )}
          </div>
        )}
      </div>

      {/* Storage */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3">
        <span className="text-gray-700 flex items-center gap-1.5" style={{ fontSize: "0.8rem", fontWeight: 600 }}>
          <Database size={13} className="text-gray-400" />
          Storage
        </span>

        <div>
          <p className="text-gray-900" style={{ fontSize: "1.6rem", fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1 }}>{total}</p>
          <p className="text-gray-400 mt-0.5" style={{ fontSize: "0.7rem" }}>เอกสารทั้งหมด</p>
        </div>

        <div className="flex h-1 rounded-full overflow-hidden bg-gray-100">
          <div className="bg-gray-800" style={{ width: `${ditcPct}%` }} />
          <div className="bg-gray-300 flex-1" />
        </div>

        <div className="flex flex-col gap-1.5">
          {[
            { label: "DITC", count: ditcDocs, color: "bg-gray-800" },
            { label: "CAMT", count: camtDocs, color: "bg-gray-300" },
          ].map(({ label, count, color }) => (
            <div key={label} className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-sm ${color}`} />
                <span className="text-gray-400" style={{ fontSize: "0.73rem" }}>{label}</span>
              </div>
              <span className="text-gray-600" style={{ fontSize: "0.78rem", fontWeight: 600 }}>{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
