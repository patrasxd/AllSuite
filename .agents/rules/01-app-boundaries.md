# App Boundaries and Editor Lifecycle

## What belongs in an app package

Each `packages/apps/<slug>` owns its document model, in-memory state, editing commands, import/export, sanitization, local EN/PL translations, metadata and CSS. Keep pure parsing, conversion and calculation engines separate from React components; isolate browser/file adapters for deterministic tests. No shell-internal imports or dependencies on another app's runtime.

Shared primitives belong in AllUI; local reusable helpers belong in `packages/ui`. Request header content and report dirty state through props rather than reaching into shell state.

## The AppComponentProps contract

```ts
import type { ReactNode } from 'react'

export type Locale = 'en' | 'pl'

export interface AppComponentProps {
  locale: Locale
  isEink?: boolean
  setHeader?: (content: ReactNode) => void
  isDirty?: boolean
  setIsDirty?: (dirty: boolean) => void
}
```

This reuses AllTools' shell dirty contract: `isDirty?: boolean` and `setIsDirty?: (dirty: boolean) => void`, plus its header callback. Declare and honor `isEink`; use `AppComponentProps` for new apps. Active Draft uses `AppComponentProps` and reports document changes through `setIsDirty`. It shows an unsaved indicator and guards navigation/unload. File save/replacement APIs are not implemented yet; add those contracts only when requested.

Edits report dirty state to the shell. The shell owns navigation confirmation; the app guards destructive New/Open and reports successful saves. Canceled or failed saves stay dirty. Edits during an asynchronous save remain dirty unless included in the saved snapshot. Browser print cannot prove a successful file save.

## Lifecycle and Draft behavior

Draft edits exactly one document in memory. New/Open replaces it only after unsaved-change confirmation. Each document gets its own editor instance/history. Sanitize imported and pasted HTML before setting content; remove remote images, scripts, active content and unsafe links. Preserve supported embedded raster images. DOCX conversion is semantic, not exact pagination; communicate unsupported content.

Clean up header contributions, listeners, timers, object URLs and editor instances on unmount; release in-memory file handles when the session ends. Do not force service-worker updates while dirty. Follow [05-privacy-storage.md](05-privacy-storage.md) for storage and unsaved warnings.
