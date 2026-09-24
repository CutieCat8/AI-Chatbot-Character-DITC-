import { useEffect, useRef } from "react";
import type { VoiceConnectionState } from "../hooks/useVoiceSocket";
import "./LiveVoicePanel.css";

interface Props {
  connectionState: VoiceConnectionState;
  transcript: string;
  errorMessage: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
}

const STATUS_LABEL: Record<VoiceConnectionState, string> = {
  idle: "ยังไม่เริ่ม",
  connecting: "กำลังเชื่อมต่อ...",
  connected: "กำลังฟัง — พูดได้เลย",
  error: "เชื่อมต่อไม่สำเร็จ",
  closed: "ปิดการเชื่อมต่อแล้ว",
};

/**
 * โหมดคุยด้วยเสียงจริงผ่าน Gemini Live (ต้องมี backend รันอยู่ที่ localhost:8000 — docker compose up)
 * ครบวงจริง: ไมค์ -> WS -> Gemini Live -> เสียงตอบ
 */
export function LiveVoicePanel({ connectionState, transcript, errorMessage, onConnect, onDisconnect }: Props) {
  const isConnected = connectionState === "connected" || connectionState === "connecting";

  // เลื่อนกล่อง transcript ลงล่างสุดอัตโนมัติทุกครั้งที่มีข้อความใหม่เข้ามา — เดิมต้องเลื่อนเอง
  // (overflow-y: auto เฉย ๆ ไม่เลื่อนตามให้) ผู้ใช้ต้องเห็นคำตอบล่าสุดโดยไม่ต้องขยับเมาส์เอง
  const transcriptRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript]);

  return (
    <div className="live-voice-panel">
      <button className="live-voice-button" onClick={isConnected ? onDisconnect : onConnect}>
        {isConnected ? "⏹ หยุดคุย" : "เริ่มคุย"}
      </button>

      <p className="live-voice-status">{STATUS_LABEL[connectionState]}</p>
      {errorMessage && <p className="live-voice-error">{errorMessage}</p>}

      {transcript && (
        <div className="live-voice-transcript" ref={transcriptRef}>
          <strong>แมวพูดว่า:</strong> {transcript}
        </div>
      )}
    </div>
  );
}
