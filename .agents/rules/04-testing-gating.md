# Testing and gating

Match tests to changed behavior and risk. Use Vitest for engine/component rules and a few Playwright checks for browser-only contracts: file import/export, offline operation and unsaved updates. Keep privacy, accessibility, EN/PL and lazy-loading coverage.

## Checks

- During changes, run focused tests and typecheck as useful.
- Complete coherent implementation and visual review before full final suites. Do not rerun full suites after every cosmetic edit or add automated tests for every styling adjustment. Preserve meaningful behavioral, accessibility and data-integrity regressions; never weaken assertions for PASS.
- Deployment runs lint, formatting, typecheck, Vitest, build and the tagged Playwright smoke tests.
- Do not add separate scheduled test workflows, milestone gates, or broad screenshot/performance matrices.
- Add focused tests for changed behavior; avoid duplicate unit and browser coverage where one layer already proves the contract.
- Inspect bundle graphs only for new dependencies/imports or app boundaries. Keep Tiptap and conversion libraries in Draft's lazy graph.

## UI verification

Inspect the actual running production build and compare equivalent Grid/Draft controls where relevant. Capture before/after screenshots of affected flows, inspect the images, and check desktop, representative mobile and relevant themes (including light). Check dimensions, spacing, hover, visible keyboard focus, selected/pressed and disabled states. Keep checks focused on the change; this does not require a broad viewport matrix for every cosmetic fix. Automated test success alone is not visual approval. Follow the existing evidence contract for artifacts and results.
