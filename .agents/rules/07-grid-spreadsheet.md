# Grid Spreadsheet Contract

Grid is the offline spreadsheet app at `packages/apps/grid` (`@allsuite/grid`, slug `grid`). Keep its lightweight localized metadata separate from the lazy React/TypeScript runtime, following the app boundary in `01-app-boundaries.md`.

- Use AllSuite's established Draft workspace design: shared AllUI tokens, controls and layout, with an internally scrolling sheet area and status bar. Keep the independent AllSuite identity; do not copy proprietary spreadsheet branding or ribbon artwork.
- Support English and Polish UI and formula entry. Normalize localized function names and argument separators at the input boundary; store formulas in one canonical form and preserve the user's locale preference separately.
- Workbook edits live in memory. Never persist workbook contents or metadata in browser storage or send requests to external hosts. Open and save only through explicit local file actions; save XLSX explicitly.
- Treat OOXML as a package of related parts, not just cell values. Preserve unowned/unsupported parts and relationships conservatively, and report unsupported content when its preservation cannot be established. Do not claim a parse-and-rewrite library preserves opaque parts without round-trip fixtures.
- Formula functions alone are not a recalculation engine. Keep formula parsing, dependency tracking, recalculation and XLSX serialization as explicit boundaries.
- A pivot table means native workbook pivot definitions and caches. Do not substitute a summary table or claim pivot support until the required OOXML parts, relationships, cache records and saved worksheet output are covered by fixtures.
