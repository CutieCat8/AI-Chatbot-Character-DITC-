import type { VisemeCue } from "../lib/visemeTimeline";
import type { VisemeDebugSnapshot } from "../hooks/useVoiceSocket";

interface Props {
  snapshot: VisemeDebugSnapshot | null;
  currentViseme: string;
  currentCue: VisemeCue | null;
}

/** Development-only A/B telemetry. App renders this only for `?debug=1`. */
export function VisemeDebugPanel({ snapshot, currentViseme, currentCue }: Props) {
  const copySnapshot = () => {
    if (!snapshot) return;
    const payload = {
      capturedAt: new Date().toISOString(),
      ...snapshot,
      currentViseme,
      currentCue,
    };
    void navigator.clipboard?.writeText(JSON.stringify(payload, null, 2));
  };

  return (
    <aside
      data-testid="viseme-debug-panel"
      style={{
        position: "fixed",
        top: 76,
        right: 12,
        width: "min(520px, 46vw)",
        maxHeight: "calc(100vh - 88px)",
        overflow: "auto",
        background: "rgba(0, 0, 0, 0.88)",
        color: "#7fffd4",
        fontFamily: "monospace",
        fontSize: 12,
        lineHeight: 1.45,
        padding: 12,
        border: "1px solid rgba(127, 255, 212, 0.45)",
        borderRadius: 8,
        pointerEvents: "auto",
        zIndex: 900,
      }}
    >
      <div><strong>Gemini Live Viseme A/B</strong> — development debug</div>
      <div>source: {snapshot?.source ?? "waiting"}</div>
      <div>alignment: {snapshot?.alignment ?? "waiting"}</div>
      <div>final: {String(snapshot?.final ?? false)}</div>
      <div>
        current: <strong>{currentViseme}</strong>{" "}
        cue: {currentCue ? `${currentCue.startMs}-${currentCue.endMs}ms (${currentCue.pose ?? "legacy"})` : "idle"}
      </div>
      <div>cue changes/s: {snapshot?.metrics.cueChangesPerSecond.toFixed(3) ?? "0.000"}</div>
      <div>ratios: {snapshot ? JSON.stringify(snapshot.metrics.visemeRatios) : "{}"}</div>
      <div style={{ marginTop: 6 }}>transcript:</div>
      <div style={{ color: "#fff", whiteSpace: "pre-wrap" }}>{snapshot?.transcript || "(waiting)"}</div>
      <div style={{ marginTop: 6 }}>IPA:</div>
      <div style={{ color: "#ffd166", whiteSpace: "pre-wrap" }}>
        {snapshot?.ipa.length
          ? snapshot.ipa.map(({ text, ipa, status }) => `${text}: ${ipa || "(fallback)"} [${status}]`).join("\n")
          : "(none — English or fallback mode)"}
      </div>
      <div style={{ marginTop: 6 }}>timeline:</div>
      <pre style={{ margin: 0, color: "#d7f9ff", whiteSpace: "pre-wrap" }}>
        {snapshot?.timeline.map((cue) => (
          `${cue.startMs}-${cue.endMs} ${cue.viseme}${cue.pose ? `/${cue.pose}` : ""} ${cue.text ?? ""}`
        )).join("\n") || "(waiting)"}
      </pre>
      <button type="button" onClick={copySnapshot} disabled={!snapshot} style={{ marginTop: 8 }}>
        Copy A/B snapshot JSON
      </button>
    </aside>
  );
}
