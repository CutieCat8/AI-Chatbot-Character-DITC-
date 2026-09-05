import type { CatState } from "../types";
import { CAT_STATES, CAT_STATE_LABELS } from "../types";
import "./ControlPanel.css";

interface Props {
  state: CatState;
  onStateChange: (state: CatState) => void;
  onFileSelected: (file: File) => void;
  onPlay: () => void;
  onPause: () => void;
  isPlaying: boolean;
  hasAudio: boolean;
  amplitude: number;
}

/**
 * แผงควบคุมสำหรับทดสอบ — ยังไม่ต่อ backend/Gemini Live จริง ใช้สลับสถานะ+ทดสอบไฟล์เสียงเองก่อน
 * ตอนต่อ voice pipeline จริง (Sprint ถัดไป) ให้แทนที่ปุ่มพวกนี้ด้วย logic จริง:
 *   - state เปลี่ยนตาม server_content ที่ได้จาก WS (/api/voice/ws) — ดู backend/app/routers/voice.py
 *   - amplitude มาจาก useAmplitude ต่อกับ audio element ที่เล่นเสียงจาก WS แทนไฟล์ทดสอบ
 */
export function ControlPanel({
  state,
  onStateChange,
  onFileSelected,
  onPlay,
  onPause,
  isPlaying,
  hasAudio,
  amplitude,
}: Props) {
  return (
    <div className="control-panel">
      <h2>ทดสอบ (ยังไม่ต่อ backend จริง)</h2>

      <div className="control-section">
        <label className="control-label">สถานะแมว</label>
        <div className="state-buttons">
          {CAT_STATES.map((s) => (
            <button
              key={s}
              className={`state-button ${s === state ? "state-button--active" : ""}`}
              onClick={() => onStateChange(s)}
            >
              {CAT_STATE_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="control-section">
        <label className="control-label">ไฟล์เสียงทดสอบ (lip-flap ตาม amplitude จริง)</label>
        <input
          type="file"
          accept="audio/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFileSelected(file);
          }}
        />
        <div className="control-row">
          <button onClick={onPlay} disabled={!hasAudio || isPlaying}>
            ▶ เล่น
          </button>
          <button onClick={onPause} disabled={!hasAudio || !isPlaying}>
            ⏸ หยุด
          </button>
        </div>
        <div className="amplitude-meter">
          <div className="amplitude-meter-fill" style={{ width: `${amplitude * 100}%` }} />
        </div>
        <span className="amplitude-value">{amplitude.toFixed(2)}</span>
      </div>
    </div>
  );
}
