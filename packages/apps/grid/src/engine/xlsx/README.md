# Grid XLSX preservation and saving

XLSX parsing and writing run in Grid's lazy worker graph. Archive bytes, original parts, filenames and file handles remain in memory. No workbook relationships are fetched.

An unchanged imported workbook returns the original archive bytes. Edited workbooks overlay owned XML onto the original package, retaining unrelated parts and relationships. Supported values are checked by reopening the generated package before bytes can reach a writer. Tests compare exact untouched archives, preserved opaque part bytes, relationships, content types and supported XML structures. This is fixture evidence, not a claim of universal XLSX fidelity.

Every export produces a structured compatibility diff. Unsafe opaque dependencies, charts and pivot caches require an explicit Save As review; normal Save cannot overwrite the source. Save As must use another filename/handle. Unsupported changes that cannot produce a valid package block export. Known calculation chains are removed after edits and recalculation is requested; chains with unknown extensions block export. Formula expressions are retained, and stale results are never invented.

Dirty state clears only for the revision actually saved, after the file writer closes successfully. Later edits stay dirty. New/Open invalidate pending saves. Download fallback clears the saved revision after initiating the download; the UI explicitly states that browser initiation cannot verify the file reached disk. Failures and cancellations keep changes unsaved.

## Validation environment

Automated validation was run on Windows with Node 24.16.0, npm 11.13.0 and Playwright Chromium (Playwright 1.64). CI's Node 22 environment was not run locally. The raw OOXML fixtures cover normal and multi-sheet packages, styles, dates, formulas, custom XML, chart/pivot relationships, unsafe relationships, calculation chains and malformed packages. Component tests cover canceled saves, writer errors and edits during writer close; browser tests cover download and reopen flows on desktop/mobile.

Independent desktop spreadsheet acceptance remains **pending**: no desktop XLSX application is installed, as confirmed by the user. No claim has been made about repair dialogs in a desktop app. To complete acceptance, open a Grid-exported workbook in an independent desktop spreadsheet app, inspect values/styles/sheets/links/panes, and record the application version and whether any repair dialog appears.
