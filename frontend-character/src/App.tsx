import { useRef, useState } from "react";
import { CatCharacter } from "./components/CatCharacter";
import { ControlPanel } from "./components/ControlPanel";
import { useAmplitude } from "./hooks/useAmplitude";
import type { CatState } from "./types";
import "./App.css";

export function App() {
  const [state, setState] = useState<CatState>("idle");
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasAudio, setHasAudio] = useState(false);
  const objectUrlRef = useRef<string | null>(null);

  const { amplitude, resume } = useAmplitude(audioEl);

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
    resume(); // AudioContext ต้อง resume ตอน user gesture เท่านั้น เรียกตรงนี้ (ปุ่มกด) ถึงจะได้ผล
    audioEl?.play();
    setIsPlaying(true);
    // จำลองพฤติกรรมจริง: พูดอยู่ = wake, พูดจบ = กลับ idle (ของจริงจะผูกกับ turn_complete จาก WS)
    setState("wake");
  };

  const handlePause = () => {
    audioEl?.pause();
    setIsPlaying(false);
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
    setState("transition");
    setTimeout(() => setState("idle"), 400);
  };

  return (
    <div className="app">
      <audio
        ref={(el) => setAudioEl(el)}
        onEnded={handleAudioEnded}
        style={{ display: "none" }}
      />

      <div className="app-stage">
        <CatCharacter state={state} amplitude={isPlaying ? amplitude : 0} />
      </div>

      <ControlPanel
        state={state}
        onStateChange={setState}
        onFileSelected={handleFileSelected}
        onPlay={handlePlay}
        onPause={handlePause}
        isPlaying={isPlaying}
        hasAudio={hasAudio}
        amplitude={amplitude}
      />
    </div>
  );
}
