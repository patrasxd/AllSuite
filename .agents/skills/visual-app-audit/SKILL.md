---
name: visual-app-audit
description: Audit an AllSuite app for viewport usage, four-theme rendering, accessibility and visible-toolbar/internal-document scrolling defects.
---

# Visual App Audit Skill

Use to inspect an app screen or verify a requested visual change. Read the [theme](../../rules/02-themes-motion.md), [layout](../../rules/03-responsive-layout.md) and [testing](../../rules/04-testing-gating.md) rules. An audit alone does not authorize unrelated features.

## 1. Viewport utilization

Test mobile portrait **390×844**, mobile landscape **844×390**, tablet **820×1180**, desktop **1280×800** and large desktop **1920×1080**.

Verify workspace use around intentional paper width, no outer scroll in the editor, internal document/outline scrolling, visible toolbar and 44×44px touch hit areas. Exercise long documents, zoom, panels and dialogs; retain usable height on short screens. Preserve the requested bottom status bar; do not replace the catalog with a promotional page or add a library/product footer.

## 2. Themes and motion

Check `dark`, `light`, `e-ink-light`, `e-ink-dark` at every viewport. Verify readable muted text and at least 4.5:1 normal-text contrast. E-ink uses monochrome surfaces, crisp contrasting borders (at least 2px for outlined controls/surfaces), zero shadows, blur, animation or smooth scrolling. Theme changes preserve document data.

Emulate reduced motion; updates are instant. Verify keyboard navigation, visible focus, icon labels, overflow-region reachability and unsaved indication. Test toolbar/dialogs in EN/PL, including longer labels.

## 3. Evidence and regression checks

Retain pre-change screenshots. Capture Playwright comparison baselines for all four themes at 390px/1280px, plus other audited sizes. Inspect differences instead of blindly updating snapshots. Existing `docs/` screenshots and screenshot-only tests are evidence, not automated comparison gates.

Report defects with route, theme, viewport, reproduction and image paths; distinguish existing defects from regressions. If fixes were requested, verify them and required gates. If audit-only, deliver findings without features. Use synthetic documents, not real user content, in persisted test artifacts.
