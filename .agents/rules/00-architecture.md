# AllSuite Architecture

## Repository structure

AllSuite is a browser office monorepo managed with npm workspaces and Node 22:

- `apps/shell`: Vite + React 18 + TypeScript + PWA, mounted at `/AllSuite/`. Owns routing, app registry, shared header, EN/PL preferences, themes, unsaved navigation guards and installation/update UI.
- `packages/apps/<slug>`: one self-contained package per office app, Draft first (`@allsuite/draft`). Owns editor composition and app-specific engines.
- `packages/ui`: local helpers and app-specific vector icons (`@allsuite/ui`) when needed. Never duplicate shared primitives, layouts or tokens here.
- `AllUI/`: shared Git submodule, imported as `@all/ui`. Consume shared components and templates directly.

**Current state:** workspaces are `apps/*` and `packages/apps/*`; Draft provides an in-memory editor and local file workflows. `packages/ui` does not exist. The older editor in `packages/tools/draft` is preserved locally outside active workspaces and ignored by Git, along with `tests/legacy`; it is not routed, bundled or tested by active app gates. Do not create empty packages.

## Shell and registry contract

Follow AllTools' registry pattern: an eager metadata list (`APPS_METADATA`) and lazy loader (`loadAppComponent(slug)`). Resolve routes through this registry without app-specific shell layout conditionals. The shell uses hash routes in `src/App.tsx` and the registry in `src/apps/registry.ts`; preserve static hosting until a routing change is requested.

Each package has genuinely separate module graphs:

- `src/metadata.ts`: static localized slug, name, description, category, tags and lightweight icon. No editor, conversion library or runtime component imports.
- `src/index.tsx`: component entry exporting `AppComponent`, with type-only contract exports as needed. Never re-export metadata and runtime through a common barrel consumed by the shell.
- Package exports expose `.` and `./metadata` separately. Import metadata from `@allsuite/<slug>/metadata`; load runtime with `import('@allsuite/<slug>')`.

Active Draft exports `AppComponent` from `src/index.tsx`; the preserved legacy package is outside the active contract.

## Shared UI and heavy dependencies

Use vanilla CSS, semantic tokens and shared `@all/ui` controls, dialogs, headers and responsive templates. Keep the established catalog (`DirectoryHero`, `CatalogSectionHeader`, `FilterGroup`, `CatalogGrid`, `CatalogCard`, `AppFooter`), All/Suite title, shared logo markup and locally bundled font weights. The requested Draft scaffold uses an independent toolbar, internally scrolling document pane and bottom status bar. No library pane or product footer in the app workspace.

When editor features are requested, Tiptap/ProseMirror and document import/export libraries must remain reachable only through Draft's lazy runtime graph. Dynamically load heavy conversions within the app; never import them into shell, metadata or shared helper barrels. Use editor transactions, not `document.execCommand`. Active editor setup lives in `src/editor/`, pure helpers in `src/engine/`, and UI in `src/components/`. The editor and paste sanitizer are lazy chunks.

AllSuite pins AllUI at `3e8e7d1e648dfc3e1df707938bfea42edd80f4e8`, the same clean submodule commit used by AllTools and AllGames. Update shared UI through the normal submodule pointer only; do not maintain product-local patches or copy shared components into AllSuite. Verify AllUI with its own build and tests before running the product gates.
