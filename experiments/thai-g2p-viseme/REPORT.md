# FastThaiG2P Viseme Timeline PoC

Date: 2026-09-24
Branch: `experiment/thai-g2p-viseme`
FastThaiG2P revision: `c4759eef7df03e11fcbb9aa83efe8cf21709fd2f`

## Verdict

FastThaiG2P passed the end-to-end feasibility gate as an optional Thai
grapheme-to-phoneme provider for DITC CAT. In the visual A/B test, round B
looked better than round A. The feature remains disabled by default and the
existing text-driven timeline remains the fail-open fallback.

This is still a PoC. The generated cues are phoneme-informed, but they are not
phoneme-to-audio forced alignment. When Gemini does not supply usable word
timestamps, phoneme weights are distributed across the received PCM duration.

## Runtime configuration

- Default: `THAI_G2P_ENABLED=false`
- Docker Compose default: `${THAI_G2P_ENABLED:-false}`
- Provider initialization is process-wide and warmed during backend startup.
- Normalized Thai conversions are cached.
- Provider failure or timeout returns to the existing text-driven path.
- English remains on the existing English text-driven path.
- Mixed Thai-English text is segmented so Latin spans are not sent to Thai G2P.
- Runtime is configured for offline operation with an explicit writable
  `PYTHAINLP_DATA_DIR`.

## Docker feasibility benchmark

The benchmark used the same Python 3.13 backend container environment.

| Gate | Result | Limit | Status |
|---|---:|---:|---|
| Docker image increase | approximately 26.47 MiB | at most 150 MiB | pass |
| Isolated RSS increase after initialization | approximately 338.68 MiB | at most 400 MiB | pass |
| Initialization | approximately 3.381 s | at most 5 s | pass |
| Warm conversion | approximately 0.041 ms/message | at most 5 ms/message | pass |
| Runtime network/model download | none observed with Docker network disabled | none | pass |

The benchmark fixture is structural and performance-oriented. It is not an
accuracy benchmark for Thai pronunciation.

## Gemini Live E2E A/B setup

- Round A: `THAI_G2P_ENABLED=false`
- Round B: `THAI_G2P_ENABLED=true`
- Audio: real Gemini Live PCM playback
- Timeline alignment in the captured sessions: `pcm-duration`
- Mouth SVGs were unchanged.
- Amplitude was not used to select a viseme.
- Mapping and timing were not adjusted between the first A/B rounds.

The conversational model did not repeat every requested sentence verbatim in
every turn. Some responses added a follow-up question, repeated content, or
refused an out-of-scope instruction. Metrics therefore describe the audio that
Gemini actually produced, not a perfectly controlled paired recording.

## Test sentences

The live test set included:

1. `มา บา ปา`
2. `แม่ไปพบป้าปุ๊บ`
3. `ฟ้าใสวันนี้สวยมาก`
4. `สีสันของชีวิต`
5. `รักเราหรือเปล่า`
6. `โอเค อยู่ตรงนี้ก่อน`
7. `สวัสดีครับ ยินดีต้อนรับ`
8. `มหาวิทยาลัยเชียงใหม่`
9. `วันนี้ไป CAMT Innovation Lab กันไหม`
10. `ช่วยเปิด GitHub และ Docker ให้หน่อย`
11. `Welcome to Chiang Mai University.`
12. `วันนี้อากาศดีมาก, so let's go outside.`

## Aggregate E2E results

| Metric | Round A: text fallback | Round B: Thai G2P |
|---|---:|---:|
| Final timelines captured | 40 | 34 |
| Mean cue changes/second | 3.118 | 7.630 |
| `aa` time ratio | 47.37% | 40.01% |
| `ee` time ratio | 25.83% | 13.16% |
| `oh` time ratio | 4.22% | 5.69% |
| `mbp` time ratio | 6.37% | 9.57% |
| `fv` time ratio | 0.28% | 0.12% |
| `s` time ratio | 2.60% | 12.23% |
| `r` time ratio | not separated | 12.54% |
| `wo` time ratio | 13.33% | 6.68% |
| Backend mean RSS | 805.2 MiB | 1,083.6 MiB |
| Backend peak RSS | 808.4 MiB | 1,086.5 MiB |

The E2E backend RSS increase was approximately 278 MiB. These measurements
include the development backend, Uvicorn reload process, embedding model,
FastThaiG2P, and a live voice session.

Round A CPU was sampled over the matching 881-sample measurement window:

- mean: approximately 8.94%
- peak: approximately 25.57%

The round B monitor captured memory but not a comparable CPU column. No round B
CPU number is claimed; CPU remains a measurement gap for a future controlled
run.

## Timeline summary

- `มา บา ปา` produced short `mbp` closures followed by dominant `aa` vowels.
- `แม่ไปพบป้าปุ๊บ` produced repeated lip closures for the bilabial consonants,
  plus vowel-specific `aa`, `oh`, and `wo` cues.
- `สีสันของชีวิต` emphasized `ee` for the front vowels and `s` for consonant
  groups rather than holding one generic vowel pose.
- `โอเค อยู่ตรงนี้ก่อน` used `oh` for the actual O/ออ groups. One captured
  timeline used `oh` for approximately 32.15% of that sentence, which is
  expected for its vowel content.
- English-only output remained `english-text-driven`.
- Mixed Thai-English output used IPA for Thai spans and the existing mapping for
  Latin spans.

The round B cue rate increased from 3.12 to 7.63 changes per second. It was not
reduced because the human visual review rated the final round as good. Timing
should not be changed from aggregate metrics alone because a lower rate could
remove short consonant closures.

## O-mouth dominance

No O-mouth dominance was observed. Overall `oh` time increased only from 4.22%
to 5.69%, and `oh` was selected from the IPA/text mapping rather than amplitude.

## Timeout investigation

One Thai G2P call exceeded the configured 100 ms timeout during active PCM
arrival. The provider had already completed startup warm-up and a prior timeline
successfully. There was no exception stack, crash, or continuing timeout, and
later turns returned to Thai G2P normally.

The available log cannot establish whether the individual uncached conversion,
thread scheduling, or temporary backend load caused the overrun. Determining
the exact cause would require new per-call instrumentation, which was outside
this sanitize-and-commit pass. This remains a known limitation. The important
fail-open behavior was verified: the request used the text-driven fallback and
the voice session continued.

## Interaction scope

The current voice system does not support barge-in. Speaking over the bot is
therefore not an acceptance criterion for this PoC.

In this report, `interrupt` means only the stop/disconnect behavior already
supported by the application. It does not mean microphone-driven barge-in.

Multiple reconnects and new sessions completed during the live test. A separate
visual check is still appropriate if immediate mouth return to `idle` on every
stop/disconnect path is made a release gate.

## Limitations

- No phoneme-to-audio forced alignment is available from Gemini Live in this
  pipeline.
- PCM-duration cue placement is an estimate within the real playback duration.
- Thai G2P adds approximately 278 MiB to the measured E2E backend RSS.
- Round B CPU was not captured comparably.
- `fv` coverage was too small to make a strong visual-accuracy claim.
- Loanwords and English product names use the existing English text-driven
  mapping.
- Gemini's conversational behavior made the live A/B corpus non-identical.
- A single 100 ms Thai G2P timeout remains unexplained beyond the evidence above.

## Acceptance summary

- FastThaiG2P E2E feasibility: **pass**
- Round B visual result versus round A: **better in the final human-reviewed run**
- Default feature state: **off**
- Legacy fallback: **preserved**
- O-mouth dominance: **not observed**
- Timeout fallback: **verified once**
- Forced alignment: **not implemented**
- Barge-in: **not supported and not an acceptance criterion**

## Artifacts intentionally excluded from Git

Raw backend logs, RSS sample streams, environment files, PID/process output,
runtime caches, build output, and dependency directories are intentionally not
committed. This report contains only sanitized aggregate results and test
summaries.
