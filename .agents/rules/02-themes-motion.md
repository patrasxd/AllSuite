# Themes and Motion in AllSuite

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
