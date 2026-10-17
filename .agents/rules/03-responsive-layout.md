# Responsive Layout and Workspace Allocation in AllSuite

## Viewport allocation

- Phone portrait: below 600px width.
- Phone landscape: below 900px with short height.
- Tablet: 600–1024px.
- Desktop: 1024–1440px.
- Large desktop: above 1440px.

Use available viewport space intelligently. Avoid arbitrary narrow desktop workspaces; paper width is an intentional print preview, but its surrounding workspace fills the screen. Use shared `SplitWorkspaceLayout`, `CenteredUtilityLayout` or `FullBleedLayout` where their actual APIs fit. No slug-specific shell layout checks.

## Editor scrolling contract

The active workspace has no page-level scrolling or outer horizontal overflow. Allocate the shell header and toolbar first, then give remaining height to the editor using bounded flex/grid regions (`min-height: 0`, `min-width: 0`). Keep the toolbar visible; scroll the document inside its own pane (`overflow: auto`). Outline, inspector and long lists scroll within their own panes.

On phones collapse optional panels and group actions without hiding core New/Open/Save actions. Toolbar overflow may scroll internally while the document retains usable height. On desktop use space for the canvas and optional panels. Verify zoomed paper, long documents, dialogs, virtual keyboards and short landscape screens. The user-requested Draft scaffold includes a bottom status bar outside the document scroller. Do not add a library or product footer to fill space.

Inputs, sliders, buttons and icon hit areas must be at least 44×44px on touch viewports. Keep keyboard focus visible and reachable in overflow regions. Verify 390×844, 844×390, 820×1180, 1280×800 and 1920×1080.
