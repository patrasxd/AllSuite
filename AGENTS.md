# AllSuite agent instructions

AllSuite is a private, offline office suite. Its current app is Draft, a paginated word processor. Read the matching rule in [`.agents/rules/`](.agents/rules/) and only the skill that applies to the task. Keep these instructions short; the rules define product contracts.

## Project

- Node 22, npm workspaces, Vite, React 18, TypeScript and PWA.
- Shell: `apps/shell`; app packages: `packages/apps/<slug>`; shared primitives/tokens: the AllUI submodule (`AllUI/`). Initialize submodules before `npm ci`.
- Draft is loaded through metadata plus a lazy runtime import. Keep heavy editor, import and export libraries in its lazy bundle. See [architecture](.agents/rules/00-architecture.md).
- Commands: `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e:deploy`. In Windows PowerShell, use `npm.cmd` when `npm` is not resolved (for example, `npm.cmd run typecheck`).

## Effort and scope

- Make the smallest change that satisfies the request. Do not add unrequested features, tools or reports.
- Read only rules that match the task. Do not run audits, broad viewport checks or regenerate screenshots unless the change needs them.
- During the inner loop, run only a focused `npx vitest run <file>` and `npm run typecheck` as useful.
- Before finishing a small logic change, run lint, format check, typecheck and `npm test`.
- Before finishing a UI change, also run build and only the relevant Playwright spec(s).
- Deployment runs Vitest and the small tagged Playwright smoke set. Do not add scheduled test workflows, milestone gates, or broad visual/performance matrices.
- Inspect bundle graphs only for new dependencies/imports or a new app. Audit multiple viewport sizes only for a requested audit or a new app.

## Product invariants

- No analytics, tracking, cookies, ads or requests to external hosts. Never persist document text, images or metadata in browser storage. Only explicit file saves/exports write documents to disk; do not add recent documents.
- The PWA works offline and caches static assets only. Never reload an unsaved editor to apply an update; preserve unsaved content through update activation.
- Keep editor engines and heavy conversion libraries in the lazy Draft graph.
- Preserve accessible names, keyboard operation, visible focus and touch targets of at least 44px. Support English and Polish.
- Use AllSuite identity and shared AllUI controls; follow the license rule for dependency changes.

## Workflow

Inspect the checkout, relevant instructions, manifests, CI and Git status first. Make requested changes in one go. Do not create a separate branch for a task or commit after each small change. Preserve unrelated work, the AllUI submodule revision and local changes. Do not commit, push, publish or deploy unless explicitly requested. Report checks that were not run and the reason.

AllProject itself is not a Git repository; run Git inside AllSuite. Historical code and ignored local audit files are context, not active contracts.
