# wLipSync 1.3.1 isolated smoke-test report

Date: 2026-09-24

Branch: `experiment/lipsync-engine`

Scope: isolated structural/runtime test only. This is not an integration with DITC CAT and is not evidence of phoneme accuracy.

## Final verdict — NO-GO

`wlipsync@1.3.1` **fails the DITC CAT go/no-go gate**. Integration must not proceed because a source-level defect is confirmed: the MFCC extraction loop uses the number of profile entries (`profile.mfccCount`) as its loop bound, while the output buffer contains exactly 12 MFCC coefficients.

The official 12-entry sample happens to match that fixed coefficient count. Profiles with other entry counts can initialize and emit plausible finite values without proving that the MFCC computation is correct.

The decision is final for this package/version under the current experiment:

- Do not integrate `wlipsync@1.3.1` into DITC CAT.
- Do not create or adopt a local fork.
- Do not work around the defect by forcing production profiles to contain exactly 12 entries.
- Keep the experiment isolated; a different implementation requires a separate evaluation and authorization.

## Isolation and environment

- All files are under `experiments/wlipsync-smoke/`.
- No DITC CAT production source, audio graph, `useVoiceSocket.ts`, `CatFace.tsx`, Viseme Timeline, backend, or mouth SVG was changed.
- No merge or push was performed.
- Installed package: exact version `wlipsync@1.3.1`, locked in the isolated package and lockfile.
- Installed package footprint: 14 files, 55,532 bytes. The package embeds its WASM as a data URL in `dist/wlipsync-single.js`; no external model asset was downloaded at runtime.
- Runtime: Chrome 153 on Windows, served from `http://127.0.0.1:4178`.
- Test input: deterministic generated tones routed through an isolated `AudioContext`. No microphone, Gemini stream, or audible DITC playback graph was used.

Official fixtures were downloaded from repository tag `v1.3.1`:

| Fixture | Bytes | SHA-256 |
|---|---:|---|
| `profile.json` | 35,461 | `4EE3AF43FE3C9C47F4AF50DD08DF15400CA5B7FF0779B5DD2E68F00CEBBACADE` |
| `profile.bin` | 713 | `47207838DD0C7E979341D84EF5F87A296EFDA3BA3DB12D7EC188A6547BD65974` |

## Runtime results

Both JSON and BIN were tested for the official sample and for structurally generated 8-, 12-, and 16-entry variants. Each generated pair assigns the same label to two consecutive profile entries so duplicate-label aggregation is observable.

| Profile | Format | Entries | Expected unique labels | Output labels | Worklet messages | Finite weights/volume | Processor error |
|---|---|---:|---:|---:|---:|---|---|
| Official | JSON | 12 | 6 | 6 | 84 | Yes | None |
| Official | BIN | 12 | 6 | 6 | 84 | Yes | None |
| Generated | JSON | 8 | 4 | 4 | 84 | Yes | None |
| Generated | BIN | 8 | 4 | 4 | 84 | Yes | None |
| Generated | JSON | 12 | 6 | 6 | 84 | Yes | None |
| Generated | BIN | 12 | 6 | 6 | 84 | Yes | None |
| Generated | JSON | 16 | 8 | 8 | 84 | Yes | None |
| Generated | BIN | 16 | 8 | 8 | 84 | Yes | None |

Additional observations:

- Package module, embedded WASM, and AudioWorklet initialized in all eight cases.
- All observed raw message values, aggregated weights, and volume values were finite; no `NaN` or `Infinity` was observed.
- Volume became non-zero and at least one output weight became active for every case.
- Duplicate labels were combined into one output property. Output label counts matched the expected unique-label counts.
- The browser console contained only the harness report message: no error or warning.
- All 12 network requests returned HTTP 200, including the package module, embedded WASM, and all profile fixtures.
- No `processorerror`, unhandled rejection, or visible AudioWorklet crash occurred.

These are parser and runtime-survival results only. In particular, absence of a WebAssembly trap does not prove absence of an out-of-bounds C array write inside the module's linear memory.

## Confirmed source defect

Tag `v1.3.1` contains the following relevant code:

- [`src/constants.h:3`](https://github.com/mrxz/wLipSync/blob/v1.3.1/src/constants.h#L3): `#define MFCC_NUM 12`
- [`src/main.c:27`](https://github.com/mrxz/wLipSync/blob/v1.3.1/src/main.c#L27): `float mfccOut[MFCC_NUM];`
- [`src/main.c:42`](https://github.com/mrxz/wLipSync/blob/v1.3.1/src/main.c#L42): `profile.mfccCount = mfccCount;`
- [`src/main.c:180-181`](https://github.com/mrxz/wLipSync/blob/v1.3.1/src/main.c#L180-L181): the extraction loop runs to `profile.mfccCount` and writes `mfccOut[i - 1]`.

Therefore the source loop uses the profile entry count, not the MFCC coefficient count and not a constant loop bound of 12.

### Consequences by entry count

- **8 entries:** only `mfccOut[0..7]` are refreshed. Coefficients 8 through 11 retain zero or stale values, while comparison code expects 12-dimensional MFCC data. The module can return finite but semantically incorrect weights.
- **12 entries:** the loop happens to fill exactly `mfccOut[0..11]`. This is why the official sample can appear healthy.
- **16 entries:** the loop writes `mfccOut[12..15]` past `float mfccOut[12]`. This is undefined behavior and a silent linear-memory corruption risk. It may overwrite adjacent globals without triggering a WebAssembly bounds trap because the write can remain inside the module's allocated linear memory.

This also explains why the 16-entry smoke test can report finite values and no crash: the harness validates observable JS output and worklet survival, not C object-bound safety.

## Local-fork safety assessment

The apparent code correction is mechanically small—MFCC extraction should iterate over the fixed coefficient dimension rather than the number of profile entries—but a local fork is **not yet safe to adopt into DITC CAT** without further authorization and validation.

Minimum work before considering a fork:

1. Rebuild the WASM/AudioWorklet bundle from the corrected C source with reproducible tooling.
2. Add native sanitizer or equivalent memory-safety tests where possible, plus browser regression tests for entry counts below, equal to, and above 12.
3. Verify all profile dimensions and binary parser bounds, not just this loop.
4. Compare the corrected output against uLipSync/reference calculations using known audio and profiles.
5. Validate actual phoneme discrimination separately, including a human-verified Thai/English subset; finite output is not accuracy evidence.
6. Version and document the fork so it cannot be confused with upstream `wlipsync@1.3.1`.

No dependency source was patched and no fork was created in this spike.

## Reproduction

From `experiments/wlipsync-smoke/`:

```powershell
npm install --ignore-scripts
npm run fetch:fixtures
npm run generate:variants
npm run audit:source
npm run serve
```

Open `http://127.0.0.1:4178` in a Web Audio/AudioWorklet-capable browser and select **Run smoke test**.

## Files created by the smoke test

- `package.json`, `package-lock.json`, `.gitignore`
- `index.html`, `server.mjs`, `src/main.js`
- `scripts/fetch-fixtures.mjs`
- `scripts/generate-variants.mjs`
- `scripts/audit-source.mjs`
- `fixtures/official/profile.json`, `fixtures/official/profile.bin`
- `fixtures/generated/profile-{8,12,16}.json`
- `fixtures/generated/profile-{8,12,16}.bin`
- `README.md`, `REPORT.md`

The official and generated profile fixtures are retained locally for inspection but excluded from version control because the included scripts reproduce them. `node_modules/` is also ignored and remains confined to the isolated experiment directory. No build output, browser cache, screenshots, or temporary captures are included in the commit.
