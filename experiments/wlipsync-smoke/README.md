# wLipSync 1.3.1 isolated smoke test

This harness is isolated from both production frontends. It does not import or modify DITC CAT code and does not test phoneme accuracy.

It checks the official JSON/binary sample profiles plus in-memory profiles with 8, 12, and 16 entries. Generated profiles deliberately use one label for every two acoustic entries to verify duplicate-label output behavior.

The browser test records:

- AudioWorklet initialization and messages
- finite raw volume, public volume, and public weights
- profile entry and unique output-label counts
- duplicate-label collapsing
- `processorerror`, window errors, and unhandled rejections

Run only inside this directory:

```powershell
npm install
npm run fetch:fixtures
npm run generate:variants
npm run audit:source
npm run serve
```

Open `http://127.0.0.1:4178`, click **Run smoke test**, and inspect `window.__WLIPSYNC_SMOKE_REPORT__`.
