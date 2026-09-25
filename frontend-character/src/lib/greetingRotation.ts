import manifestJson from "./greetingManifest.json";
import type { VisemeCue } from "./visemeTimeline";

export interface GreetingVariant {
  id: string;
  file: string;
  text: string;
  durationMs: number;
  timeline: VisemeCue[];
}

interface GreetingManifest {
  version: number;
  greetings: GreetingVariant[];
}

export interface GreetingRotationState {
  remainingIndices: number[];
  lastIndex: number | null;
}

const manifest = manifestJson as unknown as GreetingManifest;

if (manifest.version !== 1 || manifest.greetings.length === 0) {
  throw new Error("Invalid or empty greeting manifest");
}

export const GREETING_VARIANTS: readonly GreetingVariant[] = manifest.greetings;

export function createGreetingRotationState(): GreetingRotationState {
  return { remainingIndices: [], lastIndex: null };
}

function shuffledIndices(count: number, random: () => number): number[] {
  const indices = Array.from({ length: count }, (_, index) => index);
  for (let index = indices.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [indices[index], indices[swapIndex]] = [indices[swapIndex], indices[index]];
  }
  return indices;
}

/**
 * Draw from a shuffle bag: every greeting is used once before the next cycle,
 * and the first greeting of a new cycle cannot repeat the previous cycle's last.
 */
export function drawNextGreeting(
  state: GreetingRotationState,
  random: () => number = Math.random,
): { greeting: GreetingVariant; state: GreetingRotationState } {
  let remaining = [...state.remainingIndices];
  if (remaining.length === 0) {
    remaining = shuffledIndices(GREETING_VARIANTS.length, random);
    if (remaining.length > 1 && remaining[0] === state.lastIndex) {
      const swapIndex = remaining.findIndex((index) => index !== state.lastIndex);
      [remaining[0], remaining[swapIndex]] = [remaining[swapIndex], remaining[0]];
    }
  }

  const selectedIndex = remaining.shift();
  if (selectedIndex === undefined) throw new Error("Greeting shuffle bag is empty");
  return {
    greeting: GREETING_VARIANTS[selectedIndex],
    state: { remainingIndices: remaining, lastIndex: selectedIndex },
  };
}

export function greetingAudioUrl(file: string): string {
  return `${import.meta.env.BASE_URL}audio/greetings/${file}`;
}
