# Testing and gating

Match tests to changed behavior and risk. Use Vitest for engine/component rules and a few Playwright checks for browser-only contracts: file import/export, offline operation and unsaved updates. Keep privacy, accessibility, EN/PL and lazy-loading coverage.

## Checks

- During changes, run focused tests and typecheck as useful.
- Deployment runs lint, formatting, typecheck, Vitest, build and the tagged Playwright smoke tests.
- Do not add separate scheduled test workflows, milestone gates, or broad screenshot/performance matrices.
- Add focused tests for changed behavior; avoid duplicate unit and browser coverage where one layer already proves the contract.
- Inspect bundle graphs only for new dependencies/imports or app boundaries. Keep Tiptap and conversion libraries in Draft's lazy graph.
