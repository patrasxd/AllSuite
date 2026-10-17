---
name: visual-app-audit
description: Audit an AllSuite app when the user asks for a visual or responsive review.
---

# Visual app audit

Use only for a requested audit or visual change. Read the matching [theme](../../rules/02-themes-motion.md), [layout](../../rules/03-responsive-layout.md) and [testing](../../rules/04-testing-gating.md) rules. Do not add unrelated features.

For a full audit, inspect 390×844, 844×390, 820×1180, 1280×800 and 1920×1080 in all four themes: `dark`, `light`, `e-ink-light`, `e-ink-dark`. Check space use, internal scrolling, toolbar visibility, long documents, dialogs, focus, keyboard reachability, 44px touch targets, reduced motion and EN/PL labels. Verify normal text contrast is at least 4.5:1; e-ink has crisp monochrome surfaces, 2px outlined controls, no shadows/blur/animation, and respects reduced motion.

For a focused visual change, check only affected viewports and themes. This repository does not maintain screenshot baselines; use a focused browser check when behavior needs it.

Use synthetic document content. Report any defect with route, theme, viewport and reproduction. Distinguish existing defects from regressions.
