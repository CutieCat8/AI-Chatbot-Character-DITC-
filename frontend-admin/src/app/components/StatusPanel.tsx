import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, AlertTriangle, Database } from "lucide-react";
import { getDocumentStats, getSyncStatus, triggerSync } from "../../lib/api";

function formatTime(iso: string | null): string {
  if (!iso) return "ยังไม่เคย sync";
  return new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) + " น.";
}

export function StatusPanel() {
  const [ditcDocs, setDitcDocs] = useState(0);
  const [camtDocs, setCamtDocs] = useState(0);
  const [total, setTotal] = useState(0);

  const [isRunning, setIsRunning] = useState(false);
  const [todayCount, setTodayCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [needsAttention, setNeedsAttention] = useState(0);

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
  }, []);

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
        }
      }, 3000);
    }
    return () => {
      if (!isRunning && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [isRunning, loadStats]);

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
            <span className="text-gray-500" style={{ fontSize: "0.7rem" }}>{formatTime(lastSyncedAt)}</span>
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

      {/* Attention */}
      <div className="bg-white rounded-xl border border-amber-100 shadow-sm p-4 flex flex-col gap-2.5">
        <span className="text-gray-700 flex items-center gap-1.5" style={{ fontSize: "0.8rem", fontWeight: 600 }}>
          <AlertTriangle size={13} className="text-amber-400" />
          Needs Attention
        </span>

        <div className="flex items-center justify-between bg-amber-50 rounded-lg px-3 py-2.5">
          <div>
            <p className="text-amber-700" style={{ fontSize: "1.1rem", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1 }}>{needsAttention}</p>
            <p className="text-amber-500 mt-0.5" style={{ fontSize: "0.68rem" }}>ยังไม่ได้ index</p>
          </div>
        </div>
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
