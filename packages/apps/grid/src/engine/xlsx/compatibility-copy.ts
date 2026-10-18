import type {
  CompatibilityCategory,
  CompatibilityFinding,
  CompatibilityCode,
  XlsxSaveDiffCategory,
  XlsxSaveDiffEntry,
} from './types'

export function getXlsxCopy(locale: 'en' | 'pl') {
  const isPolish = locale === 'pl'
  const category: Record<CompatibilityCategory, string> = isPolish
    ? {
        supported: 'Obsługiwane i edytowalne',
        'readable-not-editable': 'Czytelne, bez edycji w Grid',
        'preservable-opaque': 'Zachowane jako nieprzezroczyste',
        'at-risk': 'Zagrożone',
        blocked: 'Zablokowane',
      }
    : {
        supported: 'Supported and editable',
        'readable-not-editable': 'Readable, not editable here',
        'preservable-opaque': 'Preservable opaque content',
        'at-risk': 'At risk',
        blocked: 'Blocked',
      }
  return {
    saveWorkbook: isPolish ? 'Zapisz' : 'Save',
    saveWorkbookAs: isPolish ? 'Zapisz jako' : 'Save As',
    saveCopySuffix: isPolish ? ' kopia' : ' copy',
    savePreflightTitle: isPolish ? 'Kontrola zapisu skoroszytu' : 'Workbook save review',
    savePreflightHelp: isPolish
      ? 'Sprawdz zachowane czesci i ryzyko przed zapisem. Zapis jako tworzy nowy plik.'
      : 'Review package changes, preserved unsupported parts and risks. Save As creates a new file.',
    saveCancel: isPolish ? 'Anuluj zapis' : 'Cancel save',
    saveAsAction: isPolish ? 'Zapisz jako nowy plik' : 'Save As new file',
    saveBlocked: isPolish
      ? 'Nie mozna bezpiecznie utworzyc prawidlowego pliku XLSX. Zmiany pozostaja niezapisane.'
      : 'Grid could not create a valid XLSX package. Your edits remain unsaved.',
    saveDone: isPolish ? 'Zapisano skoroszyt.' : 'Workbook saved.',
    saveSnapshotDone: isPolish
      ? 'Zapisano wcześniejszą wersję. Nowsze zmiany pozostają niezapisane.'
      : 'The earlier snapshot was saved. Newer edits remain unsaved.',
    saveAsDifferentFile: isPolish
      ? 'Wybierz nową nazwę pliku. Zapisz jako nie może nadpisać pliku źródłowego.'
      : 'Choose a new filename. Save As cannot overwrite the source file.',
    saveFormulaWarning: isPolish
      ? 'Niektóre formuły nie zostały przeliczone przez Grid. Zachowano ich wyrażenia i wyniki z pamięci podręcznej; zgodny program może przeliczyć je po otwarciu.'
      : 'Some formulas were not recalculated by Grid. Their expressions and cached results were kept; a compatible app may recalculate them on open.',
    saveDownloadStarted: isPolish
      ? 'Rozpoczeto pobieranie XLSX. Przegladarka nie potwierdza jego zakonczenia.'
      : 'XLSX download was initiated. The browser does not confirm that the download finished.',
    saveCancelled: isPolish
      ? 'Anulowano zapis. Zmiany pozostaja niezapisane.'
      : 'Save canceled. Your edits remain unsaved.',
    saveFailed: isPolish
      ? 'Zapis nie powiodl sie. Zmiany pozostaja niezapisane.'
      : 'Save failed. Your edits remain unsaved.',
    saveProgress: (phase: string, percent: number) => `${phase} ${percent}%`,
    savePhaseInspect: isPolish ? 'Sprawdzanie czesci' : 'Inspecting parts',
    savePhasePatch: isPolish ? 'Przygotowywanie XLSX' : 'Preparing XLSX',
    savePhaseValidate: isPolish ? 'Sprawdzanie pakietu' : 'Validating package',
    saveMoreEntries: (count: number) =>
      isPolish ? `i ${count} kolejnych pozycji raportu.` : `and ${count} more report entries.`,
    saveCategory: saveCategories(isPolish),
    saveEntry: (entry: XlsxSaveDiffEntry) => formatSaveEntry(isPolish, entry),
    openWorkbook: isPolish ? 'Otwórz' : 'Open',
    importingWorkbook: isPolish ? 'Sprawdzanie skoroszytu' : 'Inspecting workbook',
    cancelImport: isPolish ? 'Anuluj import' : 'Cancel import',
    importCancelled: isPolish
      ? 'Anulowano import skoroszytu. Otwarty skoroszyt nie został zmieniony.'
      : 'Workbook import canceled. The open workbook was not changed.',
    openUnsupported: isPolish
      ? 'Wybierz skoroszyt .xlsx. Starsze pliki .xls, .xlsb oraz pliki z makrami nie są obsługiwane.'
      : 'Choose an .xlsx workbook. Older .xls, .xlsb and macro-enabled files are not supported.',
    openFailed: isPolish
      ? 'Nie udało się odczytać skoroszytu. Otwarty skoroszyt nie został zmieniony.'
      : 'The workbook could not be read. The current workbook is unchanged.',
    openTooLarge: isPolish
      ? 'Skoroszyt przekracza limit importu w pamięci Grid. Otwarty skoroszyt nie został zmieniony.'
      : 'This workbook exceeds Grid’s in-memory import limit. The current workbook is unchanged.',
    openSizeLimit: isPolish ? 'Plik przekracza obsługiwany limit rozmiaru' : 'File exceeds the supported size limit',
    openPreflightTitle: isPolish ? 'Kontrola zgodności skoroszytu' : 'Workbook compatibility check',
    openPreflightSummary: (sheets: number, cells: number) =>
      isPolish
        ? `Sprawdzono ${sheets} arkusze i ${cells.toLocaleString('pl')} wypełnionych komórek.`
        : `${sheets} sheets and ${cells.toLocaleString('en')} populated cells were inspected.`,
    openPreflightHelp: isPolish
      ? 'Sprawdź, co Grid może edytować, co pozostanie nieprzezroczyste i które części mogą być zagrożone.'
      : 'Review what Grid can edit, what will remain opaque, and which parts may be at risk before opening.',
    openWorkbookAction: isPolish ? 'Otwórz skoroszyt' : 'Open workbook',
    openCancelAction: isPolish ? 'Anuluj' : 'Cancel',
    openBlocked: isPolish
      ? 'Nie można otworzyć skoroszytu, ponieważ jego struktura lub zawartość nie jest bezpieczna do importu.'
      : 'This workbook cannot be opened because its structure or content is not safe to import.',
    confirmOpen: isPolish
      ? 'Odrzucić niezapisane zmiany i otworzyć ten skoroszyt?'
      : 'Discard unsaved workbook changes and open this workbook?',
    workbookOpened: isPolish
      ? 'Otworzono skoroszyt w pamięci. Nie użyto sieci ani pamięci przeglądarki.'
      : 'Workbook opened in memory. No network requests or browser storage were used.',
    importProgress: (phase: string, percent: number) => `${phase} ${percent}%`,
    importPhaseInspect: isPolish ? 'Sprawdzanie archiwum' : 'Checking archive',
    importPhaseDecompress: isPolish ? 'Odczytywanie części skoroszytu' : 'Reading workbook parts',
    importPhaseMap: isPolish ? 'Przygotowywanie arkuszy' : 'Mapping worksheets',
    importCategory: category,
    importFinding: (finding: CompatibilityFinding) => formatFinding(locale, finding),
    importPartLabel: isPolish ? 'Części pakietu' : 'Package parts',
  }
}

function saveCategories(isPolish: boolean): Record<XlsxSaveDiffCategory, string> {
  return isPolish
    ? {
        preserved: 'Zachowane',
        'intentionally-updated': 'Celowo zaktualizowane',
        'unsupported-preserved': 'Nieobslugiwane, zachowane bez zmian',
        'stale-calculation': 'Wyniki formul wymagaja przeliczenia',
        'at-risk': 'Zagrozone zachowanie',
        'cannot-preserve': 'Nie mozna bezpiecznie zapisac',
      }
    : {
        preserved: 'Preserved',
        'intentionally-updated': 'Intentionally updated',
        'unsupported-preserved': 'Unsupported, preserved unchanged',
        'stale-calculation': 'Formula results need recalculation',
        'at-risk': 'Preservation at risk',
        'cannot-preserve': 'Cannot safely save',
      }
}

function formatSaveEntry(isPolish: boolean, entry: XlsxSaveDiffEntry): string {
  const part = entry.partName ? ` (${entry.partName})` : ''
  const messages: Record<XlsxSaveDiffEntry['code'], string> = isPolish
    ? {
        'part-preserved': `Czesc pakietu zachowano bez zmian${part}.`,
        'part-updated': `Czesc pakietu zaktualizowano z modelu${part}.`,
        'part-removed': `Usunięto nieaktualny łańcuch obliczeń${part}; zgodny program może go odbudować.`,
        'unsupported-part-preserved': `Nieobslugiwana czesc pozostala zachowana${part}.`,
        'unsafe-part-preserved': `Czesc zachowano, ale zmiany moga uniewaznic jej zaleznosci${part}.`,
        'formula-not-recalculated': `Grid nie przeliczyl lokalnie ${entry.count ?? 0} formul; zachowano ich wyniki podreczne.`,
        'formula-cache-stale': `${entry.count ?? 0} wynikow formul jest nieaktualnych; zachowano znane wartosci i wlaczono przeliczenie przy otwarciu.`,
        'output-invalid': 'Wynikowy pakiet XLSX jest nieprawidlowy.',
        'unsupported-sheet-feature': 'Zmiana arkusza wymaga funkcji, ktorych Grid nie moze bezpiecznie zaktualizowac.',
        'unsupported-style': 'Ten styl nie moze byc bezpiecznie zapisany.',
        'save-as-required': 'Utworz nowy plik, aby uniknac nadpisania skoroszytu z ryzykownymi zmianami.',
      }
    : {
        'part-preserved': `Package part was preserved unchanged${part}.`,
        'part-updated': `Package part was updated from the workbook model${part}.`,
        'part-removed': `The outdated calculation chain was removed${part}; a compatible app can rebuild it.`,
        'unsupported-part-preserved': `Unsupported package part was preserved${part}.`,
        'unsafe-part-preserved': `Part was retained, but edits may invalidate its dependencies${part}.`,
        'formula-not-recalculated': `Grid did not recalculate ${entry.count ?? 0} formulas locally; cached results were retained.`,
        'formula-cache-stale': `${entry.count ?? 0} formula caches are stale; known values were kept and recalculation on open was requested.`,
        'output-invalid': 'The resulting XLSX package is invalid.',
        'unsupported-sheet-feature': 'This sheet change needs feature updates Grid cannot safely make.',
        'unsupported-style': 'This style cannot be written safely.',
        'save-as-required': 'Create a new file to avoid overwriting a workbook with risky changes.',
      }
  return messages[entry.code]
}

function formatFinding(locale: 'en' | 'pl', finding: CompatibilityFinding): string {
  const messages: Record<CompatibilityCode, (count: number) => string> =
    locale === 'pl'
      ? {
          'supported-content': () =>
            'Zaimportowano arkusze, wartości, zapisane wyniki formuł, style, scalenia i obsługiwane ustawienia.',
          'defined-names': (count) =>
            `Nazwy zdefiniowane (${count}) zachowano wraz z zakresem i oryginalnym wyrażeniem; edycja w interfejsie jest niedostępna.`,
          'formula-cache': (count) =>
            `${count} formuł zachowuje źródło i zapisany wynik; Grid nie przelicza formuł podczas importu.`,
          'malformed-formula': (count) =>
            `${count} formuł wygląda na niepoprawne, ale ich źródło i zapisane wyniki pozostają zachowane.`,
          'shared-formula': (count) =>
            `${count} komórek formuł współdzielonych nie można rozwinąć do edycji; zapisane wyniki pozostają zachowane.`,
          charts: (count) => `Części wykresów (${count}) nie będą wyświetlane; oryginalne części pozostają w pamięci.`,
          pivots: (count) =>
            `Części tabel przestawnych lub pamięci podręcznej (${count}) nie są edytowalne; źródła pozostają w pamięci.`,
          drawings: (count) => `Części rysunków (${count}) nie będą wyświetlane.`,
          images: (count) => `Części obrazów (${count}) nie będą wyświetlane.`,
          tables: (count) => `Zaimportowano ${count} opisów tabel; funkcji tabel nie można tutaj edytować.`,
          validations: (count) => `Zaimportowano ${count} reguł poprawności danych jako metadane tylko do odczytu.`,
          'conditional-formats': (count) =>
            `Zaimportowano ${count} reguł formatowania warunkowego jako metadane tylko do odczytu.`,
          comments: (count) => `Części komentarzy (${count}) można odczytać, ale nie edytować.`,
          'external-references': () =>
            'Zewnętrzne odwołania do skoroszytów są zachowane jako dane; nigdy nie zostaną pobrane.',
          'external-targets': () => 'Linki zewnętrzne są nieaktywne w Grid; nic nie zostanie otwarte ani pobrane.',
          'custom-xml': () => 'Własny XML jest zachowany jako nieprzezroczysta część pakietu.',
          extensions: () => 'Listy rozszerzeń zawierają funkcje, których Grid nie interpretuje.',
          'unknown-parts': (count) => `Nierozpoznane części pakietu (${count}) pozostają jako nieprzezroczyste dane.`,
          'unknown-nodes': () =>
            'Niektóre węzły XML nie są interpretowane; oryginalne bajty pozostają dostępne w pamięci.',
          'active-content': () =>
            'Wykryto makra lub aktywną zawartość. Skoroszyt jest zablokowany i nic nie zostanie uruchomione.',
          'embedded-objects': () => 'Wykryto osadzone obiekty. Skoroszyt jest zablokowany.',
          'unsupported-cell-types': (count) => `Typ komórek (${count}) nie jest obsługiwany; zachowano surowy tekst.`,
          'unsupported-style-details': () => 'Niektóre szczegóły stylu nie są mapowane na edytowalny model komórki.',
          'hidden-sheets': (count) => `Ukryte arkusze (${count}) zaimportowano, ale nie są widoczne w kartach arkuszy.`,
          'archive-invalid': () =>
            'Archiwum ZIP jest uszkodzone, niespójne lub zawiera powtórzone albo niebezpieczne ścieżki.',
          'archive-limit': () => 'Archiwum przekracza limit rozmiaru, liczby części lub współczynnika kompresji.',
          encrypted: () => 'Nie można otworzyć skoroszytu chronionego hasłem.',
          'unsupported-extension': () => 'To nie jest plik .xlsx.',
          'unsupported-version': () => 'Ta wersja formatu skoroszytu nie jest obsługiwana.',
          'malformed-xml': () => 'Część XML jest uszkodzona lub zawiera zabronioną deklarację encji.',
          'unsafe-relationship': () => 'Relacja pakietu jest uszkodzona lub wychodzi poza archiwum skoroszytu.',
          'broken-shared-string': () => 'Komórka odwołuje się do brakującego tekstu współdzielonego.',
          'invalid-workbook': () => 'Struktura skoroszytu jest niepełna lub nieprawidłowa.',
        }
      : {
          'supported-content': () =>
            'Sheets, cell values, cached formulas, styles, merges and supported worksheet settings were mapped.',
          'defined-names': (count) =>
            `${count} defined names retain their scope and original expressions; UI editing is unavailable.`,
          'formula-cache': (count) =>
            `${count} formulas keep their original source and cached result; Grid does not recalculate formulas during import.`,
          'malformed-formula': (count) =>
            `${count} formula source${count === 1 ? '' : 's'} look malformed but remain stored with their cached results.`,
          'shared-formula': (count) =>
            `${count} shared formula cell${count === 1 ? '' : 's'} cannot be expanded for editing; cached results are kept.`,
          charts: (count) =>
            `${count} chart part${count === 1 ? '' : 's'} are not rendered; original package parts remain in memory.`,
          pivots: (count) =>
            `${count} pivot table/cache part${count === 1 ? '' : 's'} are not editable; source parts remain in memory.`,
          drawings: (count) => `${count} drawing part${count === 1 ? '' : 's'} are not rendered.`,
          images: (count) => `${count} image part${count === 1 ? '' : 's'} are not rendered.`,
          tables: (count) =>
            `${count} table descriptor${count === 1 ? '' : 's'} imported; table features are not editable here.`,
          validations: (count) =>
            `${count} data validation rule${count === 1 ? '' : 's'} imported as read-only metadata.`,
          'conditional-formats': (count) =>
            `${count} conditional format rule${count === 1 ? '' : 's'} imported as read-only metadata.`,
          comments: (count) => `${count} comment part${count === 1 ? '' : 's'} are readable but not editable here.`,
          'external-references': () =>
            'External workbook references are retained as opaque data and will never be fetched.',
          'external-targets': () =>
            'External links are inert in Grid; no target will be opened or fetched during import.',
          'custom-xml': () => 'Custom XML is retained as an opaque package part.',
          extensions: () => 'Extension lists contain features Grid does not interpret.',
          'unknown-parts': (count) =>
            `${count} unrecognized package part${count === 1 ? '' : 's'} are retained as opaque data.`,
          'unknown-nodes': () =>
            'Some XML nodes are not interpreted; their original package bytes remain available in memory.',
          'active-content': () =>
            'Macros or active content were detected. This workbook is blocked and nothing will execute.',
          'embedded-objects': () => 'Embedded objects were detected. This workbook is blocked.',
          'unsupported-cell-types': (count) =>
            `${count} cell value${count === 1 ? '' : 's'} use a type Grid cannot edit; raw text is retained.`,
          'unsupported-style-details': () => 'Some style details are not mapped to the editable cell style model.',
          'hidden-sheets': (count) =>
            `${count} hidden worksheet${count === 1 ? '' : 's'} will be imported but are not shown in the current sheet tabs.`,
          'archive-invalid': () => 'The ZIP archive is corrupt, inconsistent or contains duplicate/unsafe paths.',
          'archive-limit': () => 'The archive exceeds an import size, entry count or compression-ratio limit.',
          encrypted: () => 'Password-encrypted workbooks cannot be opened.',
          'unsupported-extension': () => 'This is not an .xlsx file.',
          'unsupported-version': () => 'This workbook format version is not supported.',
          'malformed-xml': () => 'An XML part is malformed or contains a forbidden entity declaration.',
          'unsafe-relationship': () => 'A package relationship is broken or escapes the workbook archive.',
          'broken-shared-string': () => 'A cell refers to a shared string that is missing.',
          'invalid-workbook': () => 'The workbook structure is incomplete or invalid.',
        }
  const message = messages[finding.code](finding.count)
  const locations = finding.partNames.slice(0, 8).join(', ')
  const more = finding.partNames.length > 8 ? `, +${finding.partNames.length - 8}` : ''
  return locations ? `${message} (${locations}${more})` : message
}
