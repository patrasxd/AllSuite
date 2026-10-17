# Testing and Gating Rules for AllSuite

## Per-app testing attachment

Tests accompany app creation and behavior changes in the same task. Vitest, React Testing Library and Playwright already exist; inspect configuration before adding tooling.

1. **Pure engines:** parsing, conversions, invalid inputs, import sanitization, DOCX compatibility and supported semantic round trips. Separate engine tests from React rendering.
2. **Components:** editing commands/transactions, EN/PL labels, keyboard interaction, header cleanup, dirty reporting and document replacement. Mock file APIs for cancellation, permission denial, failed writes and edits during saving.
3. **Privacy/lifecycle:** no document storage writes (including metadata/images), denied preference storage, in-memory handles, object URL cleanup, navigation and `beforeunload` guards.
4. **Browser workflows:** New/Open/edit/Save, fallback download, sanitized paste/import, PDF command, offline loading of static assets and absence of persisted documents.
5. **Visual regression:** Playwright baselines for each of `dark`, `light`, `e-ink-light`, `e-ink-dark` at 390×844 and 1280×800. Also audit landscape/tablet/large desktop, reduced motion, long documents and toolbar visibility. Inspect before/after images; do not blindly regenerate baselines.

Active `tests/scaffold.spec.ts` compares four-theme screenshots at 390px/1280px with `tests/visual-baselines/`. Archived `tests/legacy/single-document.spec.ts` and reviewed editor images under `docs/` are historical evidence, not active gates. Editor features need corresponding new coverage; scaffold tests are not sufficient for future editing behavior.

## Gating rule

Before completion, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test` and `npm run build` must pass. CI also requires `npm run test:e2e`; run it for product changes and relevant browser/configuration work.

A real production build must emit **zero** warnings of the form `is dynamically imported ... but also statically imported ... dynamic import will not move module into another chunk`. Inspect `apps/shell/dist/bundle-report.json`, module membership and transitive static imports; initial shell chunks must not contain or eagerly reach Draft's Tiptap/ProseMirror, `docx`, `mammoth` or other heavy dependencies. Heavy libraries stay in Draft's lazy chunk graph; separate conversion subchunks are allowed. The existing build plugin checks entry membership; inspect the graph as well. Record initial bundle size changes.

For instruction-only tasks run the five standard gates, check links and skill frontmatter, and report existing failures without expanding into product fixes.
