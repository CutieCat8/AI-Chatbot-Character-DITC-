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
  connected: "🎙️ กำลังฟัง — พูดได้เลย",
  error: "เชื่อมต่อไม่สำเร็จ",
  closed: "ปิดการเชื่อมต่อแล้ว",
};

/**
 * โหมดคุยด้วยเสียงจริงผ่าน Gemini Live (ต้องมี backend รันอยู่ที่ localhost:8000 — docker compose up)
 * ต่างจาก ControlPanel (ทดสอบด้วยไฟล์เสียง) ตรงที่ตัวนี้ครบวงจริง: ไมค์ -> WS -> Gemini Live -> เสียงตอบ
 */
export function LiveVoicePanel({ connectionState, transcript, errorMessage, onConnect, onDisconnect }: Props) {
  const isConnected = connectionState === "connected" || connectionState === "connecting";

  return (
    <div className="live-voice-panel">
      <h2>คุยด้วยเสียงจริง (Gemini Live)</h2>
      <p className="live-voice-hint">ต้องรัน backend ก่อน: `docker compose up` แล้วกดปุ่มด้านล่าง (เบราว์เซอร์จะขอสิทธิ์ไมค์)</p>

      <button className="live-voice-button" onClick={isConnected ? onDisconnect : onConnect}>
        {isConnected ? "⏹ หยุดคุย" : "🎤 เริ่มคุย"}
      </button>

      <p className="live-voice-status">สถานะ: {STATUS_LABEL[connectionState]}</p>
      {errorMessage && <p className="live-voice-error">{errorMessage}</p>}

      {transcript && (
        <div className="live-voice-transcript">
          <strong>แมวพูดว่า:</strong> {transcript}
        </div>
      )}
    </div>
  );
}
