# ADR-004: Lip-sync technology selection

**Date**: 2026-09-24
**Status**: Accepted
**Deciders**: DITC CAT project team

## Context

The original mouth animation could use amplitude or frequency heuristics to detect activity, but those measurements describe loudness or spectral energy; they do not identify whether the spoken sound is `aa`, `ee`, `oh`, `mbp`, `fv`, `s`, `r`, or `wo`. Threshold tuning can make movement steadier without making the selected mouth shape phonemically correct, especially for Thai.

DITC CAT renders a ten-state SVG mouth in a React frontend while Gemini Live provides streaming PCM and text alignment metadata. The selected architecture must preserve real-time playback, avoid changing the audible audio graph, work with Thai and English, and retain the existing text-driven timeline as a safe fallback.

## Decision

Reject `wlipsync@1.3.1` and retain its harness only as archived research. Use the optional FastThaiG2P-based viseme timeline for Thai behind a feature flag, with the existing text-driven timeline as the fail-open fallback. FastThaiG2P remains an optional, feature-flagged implementation rather than an unconditional production default.

Amplitude may indicate speech activity or influence bounded visual openness, but it must not select the viseme class.

## Alternatives considered

### Wav2Lip

Wav2Lip synthesizes lip motion in raster face video using a neural model. It is not a natural fit for switching a small set of SVG mouth assets in a browser from low-latency Gemini Live PCM. Its model/runtime cost, video-frame pipeline, and typical GPU-oriented deployment add substantial complexity without directly producing the DITC CAT viseme states.

**Decision**: Do not use Wav2Lip for the real-time SVG character.

### Amoner/lipsync-engine

The investigated project did not provide a trustworthy published npm release that could be pinned, and its classifier was based on frequency/RMS heuristics rather than sufficiently reliable Thai phoneme recognition. Its Extended Viseme Set remains useful only as a design reference for grouping phonemes and describing mouth poses; its analyzer and source code are not integrated.

**Decision**: Do not integrate Amoner/lipsync-engine.

### wlipsync@1.3.1

The isolated smoke test confirmed a source-level mismatch. MFCC extraction produces a fixed 12-coefficient output, but the extraction loop uses the number of profile entries as its bound:

- With 8 profile entries, only part of the 12-value MFCC output is refreshed.
- With 12 entries, the implementation works only by coincidence because the entry count equals the coefficient count.
- With 16 entries, the loop can write beyond the 12-element MFCC output array, creating undefined behavior and a silent memory-corruption risk.

Finite browser outputs and the absence of an AudioWorklet crash do not make these cases correct or safe.

**Decision**: Reject `wlipsync@1.3.1`. Do not use a forced 12-entry production profile, patch the dependency in place, or create a local fork without a new, separately authorized evaluation. Keep the harness only to reproduce and document the rejected experiment.

See the [archived wlipsync smoke-test report](../../experiments/wlipsync-smoke/REPORT.md).

### Optional FastThaiG2P viseme timeline

FastThaiG2P converts Thai text into IPA-informed phoneme groups that map deterministically to the ten DITC CAT mouth states. It improves phoneme selection over amplitude/frequency heuristics, works offline, and fails open to the established text-driven implementation.

The E2E feasibility test found that the FastThaiG2P round looked better than the text-driven baseline, did not exhibit O-mouth dominance, and recovered through the fallback after one timeout. The implementation remains feature-flagged because it increases backend memory usage and does not provide true audio forced alignment.

See the [FastThaiG2P benchmark and E2E report](../../experiments/thai-g2p-viseme/REPORT.md).

## Consequences

### Positive

- Thai viseme classes are selected from pronunciation information rather than amplitude or frequency thresholds.
- The existing timeline remains available when the optional provider is disabled, unavailable, or times out.
- English continues to use the existing path, and mixed text can be segmented without sending English spans into Thai G2P.
- Rejected wlipsync research remains reproducible and searchable without becoming a production dependency.

### Negative

- Gemini supplies word-level timestamps rather than phoneme timestamps, so IPA-derived cues are distributed within word timing or total PCM duration.
- This is not phoneme-to-audio forced alignment.
- FastThaiG2P increased measured E2E backend RSS by approximately 278 MiB.
- Thai G2P can time out; the fallback preserves service but is less phonemically informed.

### Risks and safeguards

- Keep `THAI_G2P_ENABLED=false` as the default until deployment memory and operational behavior are accepted.
- Keep the wlipsync package and harness out of all production imports, dependencies, bundles, and audio paths.
- Do not claim phoneme-level synchronization unless a future TTS provider or forced-alignment system supplies audio-aligned phoneme timing.
- Re-evaluate any future lip-sync engine as a new decision with version-pinned source, memory-safety validation, and human-verified Thai/English audio.
