import { useRef, useState } from "react";
import { WAKE_WORD_SAMPLE_RATE, WAKE_WORD_SAMPLES } from "../hooks/wakeWordFeatures";

type Label = "positive" | "negative";

function resampleWindow(input: Float32Array, sourceRate: number): Float32Array {
  const block = Math.max(1, Math.round(sourceRate * 0.02));
  let onset = 0;
  for (let start = 0; start + block <= input.length; start += block) {
    let energy = 0;
    for (let i = start; i < start + block; i++) energy += input[i] * input[i];
    if (Math.sqrt(energy / block) > 0.015) { onset = start; break; }
  }
  // Retain a small lead-in so the first syllable is not cut off.
  const first = Math.max(0, onset - Math.round(sourceRate * 0.20));
  const out = new Float32Array(WAKE_WORD_SAMPLES);
  const ratio = sourceRate / WAKE_WORD_SAMPLE_RATE;
  for (let i = 0; i < out.length; i++) {
    const position = first + i * ratio;
    const left = Math.floor(position);
    const part = position - left;
    const a = input[left] ?? 0;
    const b = input[left + 1] ?? 0;
    out[i] = a + (b - a) * part;
  }
  return out;
}

/** Make collected speech audible and consistent without amplifying near-silence. */
function normalizeForDataset(samples: Float32Array): Float32Array {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  if (peak < 0.01) return samples;
  const gain = Math.min(12, 0.8 / peak);
  const normalized = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) normalized[i] = Math.max(-1, Math.min(1, samples[i] * gain));
  return normalized;
}

function wavBlob(samples: Float32Array): Blob {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, WAKE_WORD_SAMPLE_RATE, true); view.setUint32(28, WAKE_WORD_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true));
  return new Blob([bytes], { type: "audio/wav" });
}

export function WakeWordRecorder({ onRecordingChange }: { onRecordingChange: (active: boolean) => void }) {
  const [label, setLabel] = useState<Label>("positive");
  const [recording, setRecording] = useState(false);
  const [result, setResult] = useState<{ url: string; filename: string } | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const record = async () => {
    setResult(null);
    onRecordingChange(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false }, video: false });
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(2048, 1, 1);
      const gain = context.createGain();
      gain.gain.value = 0;
      const chunks: Float32Array[] = [];
      processor.onaudioprocess = (event) => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      source.connect(processor); processor.connect(gain); gain.connect(context.destination);
      await context.resume();
      setRecording(true);
      const stop = () => {
        stopRef.current = null;
        processor.disconnect(); source.disconnect(); gain.disconnect();
        stream.getTracks().forEach((track) => track.stop()); void context.close();
        const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
        const raw = new Float32Array(length);
        let offset = 0;
        chunks.forEach((chunk) => { raw.set(chunk, offset); offset += chunk.length; });
        const samples = normalizeForDataset(resampleWindow(raw, context.sampleRate));
        const url = URL.createObjectURL(wavBlob(samples));
        setResult({ url, filename: `wake-word-${label}-${Date.now()}.wav` });
        setRecording(false); onRecordingChange(false);
      };
      stopRef.current = stop;
      window.setTimeout(stop, 5000);
    } catch (error) {
      console.warn("Could not record wake-word sample:", error);
      setRecording(false); onRecordingChange(false);
    }
  };

  return (
    <div style={{ position: "fixed", right: 12, bottom: 12, width: 300, padding: 14, borderRadius: 8, background: "rgba(0,0,0,.82)", color: "white", zIndex: 1000 }}>
      <strong>เก็บเสียงสำหรับเทรน (test only)</strong>
      <p style={{ fontSize: 12, margin: "8px 0" }}>กดอัดแล้วพูดตามสบาย ระบบอัด 5 วินาทีและตัดช่วงคำพูดเป็น WAV 16kHz/2.0s</p>
      <select value={label} disabled={recording} onChange={(event) => setLabel(event.target.value as Label)}>
        <option value="positive">Positive — “สวัสดี ดี ไอ ที ซี”</option>
        <option value="negative">Negative — คำ/ประโยคอื่น</option>
      </select>{" "}
      <button onClick={record} disabled={recording}>{recording ? "กำลังอัด..." : "● อัด 5 วินาที"}</button>
      {result && <p style={{ marginBottom: 0 }}><a href={result.url} download={result.filename} style={{ color: "#9ef" }}>ดาวน์โหลด {result.filename}</a></p>}
    </div>
  );
}
