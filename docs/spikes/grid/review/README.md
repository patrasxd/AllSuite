# Isolated Grid architecture review

No shell imports, runtime dependency installations, product changes or lifecycle scripts. This directory strengthens the earlier spike with actual XLSX writer comparisons and the installed Formualizer engine. See [ADR 0001](../../../adr/0001-grid-architecture.md).

Run from repository root using the installed Node runtime (Node 24.16.0 used here; CI targets Node 22):

```sh
# Research only: internet access, exact upstream tarball/license inspection.
# Downloads stay in ignored tmp/grid-review. No document data is sent.
node docs/spikes/grid/review/research.mjs
node docs/spikes/grid/review/license-graph.mjs
node docs/spikes/grid/review/check-license-texts.mjs

# Offline after research; workbook generated in ignored tmp/grid-review.
node docs/spikes/grid/review/roundtrip.mjs
node node_modules/vitest/vitest.mjs run --config docs/spikes/grid/review/vitest.config.ts
node node_modules/typescript/bin/tsc -p docs/spikes/grid/tsconfig.json
node node_modules/typescript/bin/tsc -p docs/spikes/grid/review/tsconfig.json

# Chromium must be available. Run sequentially: both use loopback port 5187.
node node_modules/@playwright/test/cli.js test --config docs/spikes/grid/playwright.config.ts
node node_modules/@playwright/test/cli.js test --config docs/spikes/grid/review/playwright.config.ts
```

Results on 2026-10-18:

- Round-trip assertions passed. ExcelJS 4.4.0 and official SheetJS CE 0.20.3 both dropped the opaque part and five synthetic pivot parts. ExcelJS retained bold style, validation, merge and note; SheetJS lost bold/validation. Neither recalculated the formula cache.
- Formualizer plus narrow ZIP/XML overlay updated the source and dependent cached formula value, preserved every other uncompressed entry byte, and reopened through ExcelJS. Zero entries missing; three XML parts changed. Synthetic pivot XML is only a retention probe, not certified native pivot output.
- Four earlier Vitest fixture tests passed. Two spike TypeScript configurations passed.
- One 100x100 logical-grid browser test passed (bounded DOM, edit/navigation/scroll/accessible counts). File-URL loading failed initially; loopback HTTP fixes ES module loading without browser security overrides.
- Two engine browser tests passed: actual WASM recalculation/cycles/PL normalization with local requests only; and an explicit demonstration that the existing production CSP blocks WASM. The latter records a blocker, not compatibility.
- Root `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test` passed (62 files / 326 tests). Docs are excluded by root formatting/lint, so explicit spike formatting and TypeScript checks supplement those gates.
- Production build, app smoke/viewport tests and AllUI rebuild were not run: no product UI/source/config, AllUI code/pointer or production imports changed. No commit, push or deploy.

Evidence files are reproducible research snapshots. Registry ranges can resolve differently later; these snapshots retain the exact versions checked. `license-graph.mjs` resolves candidate runtime/required peers independently, without workspace overrides/deduplication, and is not a production license approval. `check-license-texts.mjs` checks selected/flagged tarball texts; it does not clear all transitive assets or compiled Rust. The research scripts require registry/CDN access; browser/workbook tests use local data only. Downloaded writer bundles and generated fixture are never included in product assets.

The round-trip script intentionally handles trusted fixture XML and existing numeric cells. It has no untrusted-input hardening, generalized XLSX model, structural editing, full formula mapping, chart/pivot authoring, signature handling or schema validation. The legacy grid uses hand windowing rather than React/TanStack. Screen-reader, touch, IME, real-world pivots/charts, Node 22 and real consumer interoperability remain unverified.
