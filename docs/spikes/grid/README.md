# Grid architecture spike

Proof-only files for ADR 0001. Nothing in this folder is imported by the shell, Draft or a production app. The HTML is a small Draft-aligned interaction prototype; the TypeScript tests cover a minimal formula contract and raw OOXML ZIP preservation.

Run from the repository root:

```sh
npx vitest run --config docs/spikes/grid/review/vitest.config.ts
npx tsc --project docs/spikes/grid/tsconfig.json
npx playwright test --config docs/spikes/grid/playwright.config.ts
```

The formula harness implements only arithmetic, direct cell references, cross-sheet references and cycle detection. It is not a spreadsheet engine. The workbook fixture uses existing `fflate` and `@xmldom/xmldom` modules and does not test a candidate XLSX library.

The [follow-up isolated review](review/README.md) tests the real Formualizer engine, actual ExcelJS/SheetJS round trips and the production WASM CSP blocker. The grid browser proof now uses loopback HTTP because Chromium blocks its ES module on a file URL. No shell import or product UI changes.
