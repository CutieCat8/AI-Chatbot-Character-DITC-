"""Add browser-recorded real microphone WAVs to an existing wake-word dataset."""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import soundfile as sf

from generate_dataset import CLIP_SAMPLES, SAMPLE_RATE, _augment_variants


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples", type=Path, required=True, help="directory containing wake-word-positive/negative-*.wav")
    parser.add_argument("--out", type=Path, required=True, help="dataset directory to add to")
    parser.add_argument("--augments", type=int, default=24)
    args = parser.parse_args()
    if args.augments < 1:
        parser.error("--augments must be at least 1")
    counts = {"positive": 0, "negative": 0}
    for path in sorted(args.samples.glob("wake-word-*.wav")):
        label = "positive" if "wake-word-positive-" in path.name else "negative" if "wake-word-negative-" in path.name else None
        if label is None:
            continue
        data, sample_rate = sf.read(path, dtype="float32")
        if sample_rate != SAMPLE_RATE or data.ndim != 1 or len(data) != CLIP_SAMPLES:
            raise SystemExit(f"{path} must be mono {SAMPLE_RATE}Hz with {CLIP_SAMPLES} samples")
        target = args.out / label
        target.mkdir(parents=True, exist_ok=True)
        for index, augmented in enumerate(_augment_variants(np.asarray(data), args.augments)):
            sf.write(target / f"real_{path.stem}_aug{index}.wav", augmented, SAMPLE_RATE, subtype="PCM_16")
            counts[label] += 1
    print(f"added real-speaker augmented clips: {counts}")


if __name__ == "__main__":
    main()
