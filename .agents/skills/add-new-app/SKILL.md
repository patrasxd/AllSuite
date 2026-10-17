---
name: add-new-app
description: Create and register an AllSuite office app with isolated module graphs, memory-only documents, responsive layout and attached tests.
---

# Add New App Skill

Use when asked to add an office app. Read [AGENTS.md](../../../AGENTS.md) and its architecture, boundaries, privacy, license and testing rules first. This skill does not authorize apps during an instruction-only task.

## 1. Inspect and choose the workspace

Inspect manifests, routing, exports and AllUI APIs. Choose a document workspace, split input/preview or full canvas for the actual app. Identify file/browser APIs, heavy engines and cleanup. Verify every dependency's exact license (each Tiptap extension separately) and record evidence in `THIRD_PARTY_LICENSES.md` before adding it.

Target `packages/apps/<slug>`. Active Draft has an editor core there; preserved `packages/tools/draft` is outside active workspaces. Do not reactivate legacy editor features incidentally. Add `packages/ui` only for real local helpers.

## 2. Package and module graphs

Create a private `@allsuite/<slug>` package with separate exports for `.` and `./metadata`:

- `src/metadata.ts`: localized name, description, category, tags, slug and lightweight icon; zero component/heavy-library imports.
- `src/types.ts`: `AppComponentProps` from the boundaries rule and document types.
- `src/i18n.ts`: English and Polish strings.
- Pure engines in focused modules or `src/utils/`; browser adapters separate from pure logic.
- Main React component and `src/index.tsx`, exporting `AppComponent`.

Declare `@all/ui` as `file:../../../AllUI`; consume shared controls, dialogs, `StatsHeader`, templates and tokens directly. Add `@allsuite/ui` only for a real local helper. Keep metadata/runtime out of a common barrel. Heavy engines and conversions load only inside the app's lazy graph.

## 3. Register with the shell

Follow AllTools' pattern: import `@allsuite/<slug>/metadata` into `APPS_METADATA`, add `'<slug>': () => import('@allsuite/<slug>')` to loaders and resolve through `loadAppComponent`. If no registry exists, introduce it coherently with the Draft loader, preserving hash routes, hosting base and existing export compatibility. Add the shell workspace dependency; update actual TypeScript/Vite resolution only where needed.

Wire locale, e-ink, header and dirty props. Keep toolbar visible and document scrolling internal. Documents/handles stay in memory; implement unsaved indication, replacement/navigation guards, `beforeunload`, feature-detected pickers and input/download fallback. Clean up on unmount.

## 4. Attached tests and bundle verification

Use existing Vitest/React Testing Library and Playwright. Test pure logic, components, dirty/save failures, sanitization and absence of document persistence. Inspect four-theme comparison baselines at 390px and 1280px; also audit landscape/tablet.

Run all five standard gates and relevant browser workflows. Inspect production modules and transitive static imports: zero mixed dynamic/static warnings; heavy dependencies stay in the app's lazy graph without initial-shell regressions. Record material decisions in the task or pull request notes and report evidence; do not create a repository Markdown file just to log an update.
