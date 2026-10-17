# Privacy and Storage in AllSuite

## Network and offline invariants

No analytics, trackers, cookies, ads or third-party requests. No uploads, external converters, runtime CDNs or external fonts. Bundle licensed fonts and dependencies locally. Imported documents must not initiate external requests.

Production CSP must include `connect-src 'self' blob: data:` with restrictive self-hosted script/font/worker policies and no active embedded content. The active Vite configuration includes this policy; preserve it.

Work offline as a PWA. The service worker precaches **static app assets only**, including lazy app/conversion chunks needed offline. No runtime cache of documents, generated exports, user images, document URLs or file handles. Never force updates/reloads while unsaved work exists.

## DOCUMENT CONTENT IS NEVER PERSISTED

Document text, images and metadata (title, filename, timestamps, paths, previews, IDs and history) must never be stored in IndexedDB, Cache API, localStorage or sessionStorage. No autosave database, recovery snapshot or recent-documents list. Process exactly one document in memory; save/export to disk only at the user's request. Closing/reloading loses unsaved work. Do not read, migrate or delete leftover library storage from superseded versions as an incidental change.

A `FileSystemFileHandle` may be held in memory for the current session only; never serialize it or store it in IndexedDB. Release it when its document/session is replaced or closed.

## Allowed preferences

Only tiny UI preferences (locale, theme, toolbar options) may use localStorage, with `allsuite:` namespaced keys, through the existing `@all/ui` safe storage wrapper (`safeGetItem`, `safeSetItem`, `safeGetJSON`, `safeSetJSON`, `safeRemoveItem`). Helpers catch denied/quota/parse failures; fall back to defaults or memory. Never pass documents or filenames into preference values.

Active shell preferences use `allsuite:locale` and `allsuite:theme` through shared safe helpers. The local provider adapter keeps AllUI theme context without an unsafe initial storage read; startup and tests use the same keys. Do not restore legacy `all_theme` behavior.

## File access and unsaved changes

Feature-detect the File System Access API and invoke available pickers through user gestures. Fall back to file input for Open and Blob download for Save. Cancellation or write failure must not report success or clear dirty state. Revoke temporary object URLs.

Show an accessible unsaved indicator and install a dirty-aware `beforeunload` guard. Confirm destructive New/Open and shell navigation. Browser unload text is browser-controlled; use explicit in-app confirmation for app actions. Do not claim printing saved a file or tell users documents are saved in the browser.
