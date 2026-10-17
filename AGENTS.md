# AGENTS.md

Instructions for AI coding agents working in **AllSuite** (browser office suite; first app: **Draft**, a word processor). Claude Code and Gemini CLI reach this entry point through `CLAUDE.md` and `GEMINI.md`.

The detailed, authoritative instructions live in [`.agents/`](.agents/). Read the relevant rules and matching skills before changing code; do not duplicate their content here.

## Project at a glance

- npm workspaces, Node 22, Vite + React 18 + TypeScript + PWA. Target: `apps/shell`, `packages/apps/<slug>` and `packages/ui` for local helpers.
- Current implementation: `@allsuite/draft` is the editor core in `packages/apps/draft`; hash routes use the metadata/lazy-loader registry. Older editor code is preserved outside active workspaces in `packages/tools/draft`. See [architecture](.agents/rules/00-architecture.md).
- Shared primitives, layouts and tokens come from the **AllUI** git submodule (`AllUI/`, imported as `@all/ui`). Initialize with `git submodule update --init --recursive` before installing.
- English/Polish; `dark`, `light`, `e-ink-light`, `e-ink-dark`; phone, tablet and desktop.

## Commands

```bash
npm ci                # locked workspaces after submodule initialization
npm run dev           # shell at /AllSuite/, port 5176
npm run lint          # eslint
npm run format:check  # prettier --check
npm run typecheck     # shell and imported packages
npm test              # vitest run
npm run test:ui       # pinned AllUI test suite
npm run build         # production shell and bundle report
npm run test:e2e      # Playwright against production preview, port 4176
```

## Definition of done

`lint`, `format:check`, `typecheck`, `test`, `test:ui` and `build` must pass before finishing. CI also runs `test:e2e` in [`.github/workflows/verify.yml`](.github/workflows/verify.yml). New or changed apps need tests in the same task, visual verification and bundle isolation checks under the testing rule. Report failures and environment limitations; do not claim an unrun check passed.

## Where the detailed instructions are

Rules:

- [00-architecture](.agents/rules/00-architecture.md): structure, shell, registry and shared UI.
- [01-app-boundaries](.agents/rules/01-app-boundaries.md): package ownership and component contract.
- [02-themes-motion](.agents/rules/02-themes-motion.md): themes, tokens and motion.
- [03-responsive-layout](.agents/rules/03-responsive-layout.md): viewport allocation and internal editor scrolling.
- [04-testing-gating](.agents/rules/04-testing-gating.md): engines, components, visual baselines and bundles.
- [05-privacy-storage](.agents/rules/05-privacy-storage.md): memory-only documents, safe preferences and offline behavior.
- [06-licenses-branding](.agents/rules/06-licenses-branding.md): dependency allowlist and independent design.

Skills, read the matching one when the task fits:

- [add-new-app](.agents/skills/add-new-app/SKILL.md): create and register an app with tests and responsive setup.
- [visual-app-audit](.agents/skills/visual-app-audit/SKILL.md): inspect viewport usage, themes and editor layout.

## Project invariants

- **Privacy first.** No analytics, trackers, cookies, ads or third-party requests. Document text, images and metadata are never persisted in browser storage; only explicit user file saves/exports write documents to disk. No recent-documents list.
- **Works offline** as a PWA; service workers cache static app assets only. Never reload an unsaved editor to apply an update.
- **Accessibility.** Prefer native buttons/links and shared controls. Custom clickable elements need appropriate roles, keyboard activation and visible focus; use `onKeyActivate` from `@all/ui` where appropriate. Touch targets are at least 44px.
- **Independent identity.** Use AllSuite's own naming and simple toolbar built from `@all/ui`, with dependencies covered by the license rule.

## Workflow

Inspect the current checkout first, including instructions, manifests, CI and git status. Make all requested changes in one go. Do not create a separate branch per task and do not commit after every small change, unless asked. Preserve unrelated work; do not commit, push, publish or deploy unless requested.

AllProject is not a Git repository; run Git inside AllSuite. Preserve the AllUI revision and local changes unless shared work is requested. Record material choices and current/target discrepancies in the task or pull request notes. Historical implementation and visual reports are local-only context, not current contracts.
