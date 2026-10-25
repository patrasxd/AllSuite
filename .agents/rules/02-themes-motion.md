# Themes and Motion in AllSuite

## Visual identity and controls

- AllUI is the source of truth for primitives, variants, themes, tokens and composition/template conventions. Approved production Grid and Draft establish AllSuite's visual language. GridCraft and WordCraft inform application UX patterns only; features must not introduce a separate visual identity.
- Inspect the pinned AllUI APIs and `packages/ui` before implementing UI. Reuse existing controls and templates for equivalent roles; keep domain commands in the app. Add a shared composition only for multiple real consumers, without speculative frameworks or unnecessary abstractions. Do not modify pinned AllUI unless explicitly requested.
- Equivalent actions use the same component, variant, size and spacing. Use `primary` for the principal submission (including comment/reply composers), `outline` for peer secondary commands (including Accept/Reject, bulk review, New Comment, Reply/Resolve and replacement commands), and `ghost` for tertiary content navigation. Use `secondary` for selected/pressed modes and results, with appropriate ARIA state. Use compact `sm` actions and `IconButton` for labeled icon-only actions; retain 44px touch targets. Context may justify another existing variant, but bordered, filled, text-only, selected and disabled treatments must convey an intentional hierarchy.
- Keep consequential controls clear and compact without oversized semantic color fills. Use semantic tokens and existing variants rather than hardcoded colors or one-off CSS overrides of behavior already provided by a shared component.
- Reuse `packages/ui/src/EditorChrome.tsx` for shared editor controls and `TaskPane.tsx` for document side panels. Preserve the approved ribbon groups, tabs, menus and split buttons. Shared layouts compose AllUI controls without owning application-specific commands; preserve contextual composers and pane information architecture.

## Visual themes

Support the four neutral AllTools themes:

- `dark` (default): readable dark surfaces and muted text.
- `light`: light surfaces with sufficient contrast.
- `e-ink-light`: white background, black borders, monochrome, zero shadows.
- `e-ink-dark`: black background, white borders, monochrome, zero shadows.

Use semantic `@all/ui` tokens (`--all-bg`, `--all-surface`, `--all-surface-2`, `--all-border`, `--all-text`, `--all-text-muted`, `--all-accent`, etc.). Inspect actual AllUI exports/CSS rather than inventing tokens. Preserve root `data-theme`/`data-all-theme` and legacy `data-eink="true"` compatibility. Candy and other product-specific themes are outside AllSuite's supported set.

Document formatting is independent of presentation themes. E-ink may suppress color decoration but switching themes must not rewrite document content.

## Motion profiles

Mount `MotionProvider` inside the theme provider with `forcedNone={isEink}`. Themes and motion are independent: `normal` uses subtle 150–250ms transitions; `none` is mandatory for both e-ink themes and `prefers-reduced-motion: reduce`. Expressive motion is not standard here.

In e-ink disable CSS animations/transitions, smooth scrolling, decorative blinking, shadows and blur. Reduced motion forces instant updates. Commands, selection and edits must not wait for animation. Preserve visible keyboard focus, labeled icon controls and at least 4.5:1 normal-text contrast.
