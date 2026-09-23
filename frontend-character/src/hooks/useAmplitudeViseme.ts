import { useEffect, useState } from "react";

interface UseAmplitudeActivityOptions {
  isSpeaking: boolean;
  amplitude: number;
}

/** Amplitude may drive subtle openness/activity, but never the viseme identity. */
export function useAmplitudeActivity({ isSpeaking, amplitude }: UseAmplitudeActivityOptions): number {
  const [openness, setOpenness] = useState(0);
  useEffect(() => {
    if (!isSpeaking) {
      setOpenness(0);
      return;
    }
    setOpenness((previous) => previous + (Math.min(1, Math.max(0, amplitude)) - previous) * 0.35);
  }, [amplitude, isSpeaking]);
  return openness;
}
