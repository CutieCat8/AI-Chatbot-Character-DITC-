import { useEffect, useRef, useState } from "react";
import * as tf from "@tensorflow/tfjs";
import { logMelTensor, resampleToWakeWordRate, WAKE_WORD_SAMPLE_RATE, WAKE_WORD_SAMPLES } from "./wakeWordFeatures";

const MODEL_URL = "/models/wake-word/model.json";
const INFERENCE_INTERVAL_MS = 400;
const CONFIDENCE_THRESHOLD = 0.98;
const REQUIRED_CONSECUTIVE_HITS = 3;
const DETECTION_COOLDOWN_MS = 5_000;
const WINDOW_SECONDS = WAKE_WORD_SAMPLES / WAKE_WORD_SAMPLE_RATE;

type WakeWordOptions = {
  /** Only enable listening while the voice WebSocket is fully inactive. */
  enabled: boolean;
  onDetected: () => void;
  /** Development-only overrides used for a supervised microphone experiment. */
  modelUrl?: string;
  threshold?: number;
  onScore?: (confidence: number, consecutiveHits: number) => void;
};

export type WakeWordListenerStatus = "disabled" | "loading-model" | "listening" | "error";

/**
 * A separate, local microphone listener for the idle state. Failures remain
 * isolated: the existing Start Conversation button continues to work.
 */
export function useWakeWord({ enabled, onDetected, modelUrl = MODEL_URL, threshold = CONFIDENCE_THRESHOLD, onScore }: WakeWordOptions): WakeWordListenerStatus {
  const [status, setStatus] = useState<WakeWordListenerStatus>("disabled");
  const callbackRef = useRef(onDetected);
  const scoreCallbackRef = useRef(onScore);
  const detectedAtRef = useRef(0);
  useEffect(() => { callbackRef.current = onDetected; }, [onDetected]);
  useEffect(() => { scoreCallbackRef.current = onScore; }, [onScore]);

  useEffect(() => {
    if (!enabled) {
      setStatus("disabled");
      return;
    }
    let disposed = false;
    let stream: MediaStream | undefined;
    let audioContext: AudioContext | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let processor: ScriptProcessorNode | undefined;
    let silentGain: GainNode | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let model: tf.LayersModel | undefined;
    let writeAt = 0;
    let buffered = 0;
    let hits = 0;
    const ring = new Float32Array(WAKE_WORD_SAMPLES * 4); // enough for 48 kHz input

    let stopped = false;
    const stop = () => {
      // Called from both the inference-error path and the effect cleanup —
      // tf.LayersModel.dispose()/AudioContext.close() throw/reject on a second
      // call, so this must be idempotent or a caught inference error can still
      // crash the tree via the cleanup call that follows it.
      if (stopped) return;
      stopped = true;
      if (timer) clearInterval(timer);
      processor?.disconnect();
      source?.disconnect();
      silentGain?.disconnect();
      stream?.getTracks().forEach((track) => track.stop());
      void audioContext?.close();
      model?.dispose();
    };

    const start = async () => {
      try {
        setStatus("loading-model");
        model = await tf.loadLayersModel(modelUrl);
        if (disposed) return stop();
        stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true }, video: false });
        if (disposed) return stop();
        audioContext = new AudioContext();
        source = audioContext.createMediaStreamSource(stream);
        processor = audioContext.createScriptProcessor(2048, 1, 1);
        // Keep ScriptProcessor alive without sending microphone audio to speakers.
        silentGain = audioContext.createGain();
        silentGain.gain.value = 0;
        source.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(audioContext.destination);
        processor.onaudioprocess = (event) => {
          const input = event.inputBuffer.getChannelData(0);
          for (let i = 0; i < input.length; i++) {
            ring[writeAt] = input[i];
            writeAt = (writeAt + 1) % ring.length;
          }
          buffered = Math.min(ring.length, buffered + input.length);
        };
        await audioContext.resume();
        setStatus("listening");
        timer = setInterval(() => {
          if (disposed || !model || !audioContext || buffered < audioContext.sampleRate * WINDOW_SECONDS) return;
          // A model/feature-shape mismatch throws here (e.g. a stale exported model).
          // This runs outside start()'s try/catch, so failures must be handled locally
          // or they leak tensors and leave `status` stuck on "listening".
          let input: tf.Tensor | undefined;
          let output: tf.Tensor | undefined;
          try {
            const latest = new Float32Array(Math.ceil(audioContext.sampleRate * WINDOW_SECONDS));
            const first = (writeAt - latest.length + ring.length) % ring.length;
            for (let i = 0; i < latest.length; i++) latest[i] = ring[(first + i) % ring.length];
            const samples = audioContext.sampleRate === WAKE_WORD_SAMPLE_RATE
              ? latest.slice(0, WAKE_WORD_SAMPLES)
              : resampleToWakeWordRate(latest, audioContext.sampleRate);
            input = logMelTensor(samples);
            output = model.predict(input) as tf.Tensor;
            const confidence = output.dataSync()[0];
            hits = confidence >= threshold ? hits + 1 : 0;
            scoreCallbackRef.current?.(confidence, hits);
            const now = performance.now();
            if (hits >= REQUIRED_CONSECUTIVE_HITS && now - detectedAtRef.current > DETECTION_COOLDOWN_MS) {
              detectedAtRef.current = now;
              hits = 0;
              callbackRef.current();
            }
          } catch (error) {
            console.warn("Wake-word inference failed, disabling listener:", error);
            if (!disposed) setStatus("error");
            stop();
          } finally {
            input?.dispose();
            output?.dispose();
          }
        }, INFERENCE_INTERVAL_MS);
      } catch (error) {
        // Model/microphone failures are deliberately non-fatal; button fallback remains available.
        console.warn("Wake-word listener disabled:", error);
        if (!disposed) setStatus("error");
        stop();
      }
    };
    void start();
    return () => { disposed = true; stop(); };
  }, [enabled, modelUrl, threshold]);
  return status;
}
