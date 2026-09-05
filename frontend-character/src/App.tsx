import { useRef, useState } from "react";
import { CatCharacter } from "./components/CatCharacter";
import { ControlPanel } from "./components/ControlPanel";
import { LiveVoicePanel } from "./components/LiveVoicePanel";
import { useAmplitude } from "./hooks/useAmplitude";
import { useVoiceSocket } from "./hooks/useVoiceSocket";
import type { CatState } from "./types";
import "./App.css";

type Mode = "file-test" | "live-voice";

export function App() {
  const [mode, setMode] = useState<Mode>("live-voice");

  // ---- โหมดทดสอบด้วยไฟล์เสียง (เดิม) ----
  const [fileTestState, setFileTestState] = useState<CatState>("idle");
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasAudio, setHasAudio] = useState(false);
  const objectUrlRef = useRef<string | null>(null);
  const { amplitude: fileAmplitude, resume } = useAmplitude(audioEl);

  const handleFileSelected = (file: File) => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    if (audioEl) {
      audioEl.src = url;
      setHasAudio(true);
    }
  };
  const handlePlay = () => {
    resume();
    audioEl?.play();
    setIsPlaying(true);
    setFileTestState("wake");
  };
  const handlePause = () => {
    audioEl?.pause();
    setIsPlaying(false);
  };
  const handleAudioEnded = () => {
    setIsPlaying(false);
    setFileTestState("transition");
    setTimeout(() => setFileTestState("idle"), 400);
  };

  // ---- โหมดคุยด้วยเสียงจริง (Gemini Live ผ่าน backend WS) ----
  const voice = useVoiceSocket();

  const displayState = mode === "live-voice" ? voice.catState : fileTestState;
  const displayAmplitude = mode === "live-voice" ? voice.amplitude : isPlaying ? fileAmplitude : 0;

  return (
    <div className="app">
      <audio ref={(el) => setAudioEl(el)} onEnded={handleAudioEnded} style={{ display: "none" }} />

      <div className="app-column">
        <div className="mode-tabs">
          <button
            className={`mode-tab ${mode === "live-voice" ? "mode-tab--active" : ""}`}
            onClick={() => setMode("live-voice")}
          >
            คุยด้วยเสียงจริง
          </button>
          <button
            className={`mode-tab ${mode === "file-test" ? "mode-tab--active" : ""}`}
            onClick={() => setMode("file-test")}
          >
            ทดสอบด้วยไฟล์เสียง
          </button>
        </div>

        <div className="app-stage">
          <CatCharacter state={displayState} amplitude={displayAmplitude} />
        </div>
      </div>

      {mode === "live-voice" ? (
        <LiveVoicePanel
          connectionState={voice.connectionState}
          transcript={voice.transcript}
          errorMessage={voice.errorMessage}
          onConnect={voice.connect}
          onDisconnect={voice.disconnect}
        />
      ) : (
        <ControlPanel
          state={fileTestState}
          onStateChange={setFileTestState}
          onFileSelected={handleFileSelected}
          onPlay={handlePlay}
          onPause={handlePause}
          isPlaying={isPlaying}
          hasAudio={hasAudio}
          amplitude={fileAmplitude}
        />
      )}
    </div>
  );
}
