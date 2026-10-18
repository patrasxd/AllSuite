# Grid workbook core

This folder contains a framework-independent in-memory workbook model. It imports no React, UI, archive, XML, formula, or file APIs. Formula syntax is stored as data here; parsing, locale tokenization, dependency tracking, calculation, and displayed text belong to separate adapters.

## Invariants

- Worksheet coordinates are one-based and bounded to 1,048,576 rows by 16,384 columns. `Worksheet.cells` is a sparse `Map` keyed by canonical A1 address. Empty, unformatted cells have no entry; a styled blank remains allocated.
- A `CellValue` is the stored value. Formatting and displayed text are separate concerns. Dates remain Excel serials with a number format, and formulas keep source text, canonical expression, optional AST, cached result, and calculation status independently.
- Ranges and simple defined names are modeled explicitly. A name's `scopeSheetId` controls visibility; `targetSheetId` identifies its range's sheet independently. Legacy local ranges without a target use their scope. `resolveDefinedName` prefers a local name over a global name, case-insensitively. Add/delete name commands participate in history. Deleting a sheet removes its local names and flags global names targeting it unsafe; undo restores both. Formula-bearing names and formula ASTs are not rewritten by structural edits; they are marked stale for a formula adapter. Structural row/column edits shift sparse cells, metadata, and modeled ranges, then mark formula caches stale.
- Every `WorkbookSession.execute` action is planned and validated before patches are applied. A bulk cell/range operation is one command and one undo step. Patches retain only changed cells/properties; undo and redo share one bounded in-memory history budget. New/Open adapters replace the workbook with `replaceWorkbook`, which clears history and starts a clean revision.
- Change events carry affected sheet IDs, preservation impacts, and bounded dirty regions. Cell edits report the smallest bounding cell range; row/column structure edits report a row/column band or affected sheet. Consumers should update only those regions and must not infer that a cell event recalculates formulas.
- No workbook, history, file handle, archive, or original part bytes are written to browser storage. Session replacement releases the old model when no consumer retains it.

## OOXML ownership

Future import/export adapters own parsing the ZIP package and mapping supported parts into these descriptors. `OOXMLPreservationState` keeps original archive bytes and per-part original bytes in memory only. The adapter owns those original bytes; the workbook model owns only the explicit descriptor status and declared `dependsOn` impacts. Opaque parts should default to `dependsOn: ['all']` because their references are unknown.

Cell value/style changes and structural actions add typed impacts. Matching preserved parts become `unsafe` with a reason while their bytes and relationship IDs remain present. The model never silently drops or rewrites opaque package content. A future writer must decide whether each unsafe part can be patched, retained as stale, or requires a user-visible unsupported-content decision; this model does not claim XLSX round-trip safety.

Tables, validations, conditional formats, drawings, and pivot descriptors are modeled metadata, not an XLSX implementation. Row/column edits transform their ranges. A fully deleted descriptor range is retained with `rangeStatus: 'unsafe'`; later edits cannot silently restore its safety. Merges that collapse to one cell are removed. Drawing and pivot descriptors are marked unsafe after structure changes; pivots are also marked refresh-required. Genuine pivot cache authoring and formula evaluation are explicitly out of scope.

Session-owned model objects and byte buffers are read-only to consumers by convention; edits must go through commands. `getCell`, `getRange` and name resolution return detached snapshots. Subscribe to change events for incremental rendering. Calculation adapters can supply cache updates through the core's data-only `WorkbookCalculationUpdate` contract; there is no dependency from this folder on a formula runtime. Replacement clears undo and redo together; retained external references to an old workbook remain the consumer's responsibility.
