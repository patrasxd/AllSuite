---
name: add-new-app
description: Add and register an AllSuite office app with lazy module boundaries and responsive behavior.
---

# Add a new app

Read [architecture](../../rules/00-architecture.md), [boundaries](../../rules/01-app-boundaries.md), [privacy](../../rules/05-privacy-storage.md), [licenses](../../rules/06-licenses-branding.md) and [testing](../../rules/04-testing-gating.md). Inspect existing registry patterns and actual AllUI APIs.

Create `packages/apps/<slug>` with lightweight localized `metadata.ts`, `types.ts`, EN/PL strings, focused pure engines and a React entry. Export `.` and `./metadata` separately. Add the workspace dependency and register static metadata plus a dynamic runtime loader in the shell. Keep heavy engines and conversions out of metadata and shell imports.

Use AllUI primitives and responsive templates. Check each new dependency's exact license and record it in `THIRD_PARTY_LICENSES.md`. Preserve accessible names, keyboard/focus behavior, 44px touch targets, offline operation and memory-only documents. Implement import sanitization, explicit save/export, unsaved-change guards and cleanup as relevant to the app.

Add focused tests for the app's pure logic, component behavior and critical browser workflow. Protect privacy, external-request, offline, locale and lazy-loading contracts where applicable. For a new app, check affected responsive layouts and run the deployment smoke set. Verify heavy dependencies stay in the app's lazy graph.

Run the checks required by the testing rule for this change. Report what ran and any remaining risk. Do not create extra reports or unrelated features.
