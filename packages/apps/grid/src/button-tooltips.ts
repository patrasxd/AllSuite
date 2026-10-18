import { normalizeButtonTooltip } from '@all/ui'
import type { Locale } from './types'

const descriptions: Record<Locale, Record<string, string>> = {
  en: {
    File: 'Show workbook file commands.',
    Format: 'Show cell formatting commands.',
    Undo: 'Undo the last workbook change.',
    Redo: 'Restore the workbook change you undid.',
    Open: 'Choose an XLSX workbook to open.',
    'Open workbook': 'Choose an XLSX workbook to open.',
    Save: 'Save the current workbook.',
    'Save as': 'Save a copy under a new name.',
    'Save As': 'Save a copy under a new name.',
    New: 'Create a blank workbook.',
    'New workbook': 'Create a blank workbook.',
    'Decrease decimal places': 'Show fewer decimal places.',
    'Increase decimal places': 'Show more decimal places.',
    Bold: 'Make selected cell text bold.',
    Italic: 'Italicize selected cell text.',
    Underline: 'Underline selected cell text.',
    'Wrap text': 'Wrap text within selected cells.',
    'Clear formats': 'Remove formatting from selected cells.',
    'Formula functions': 'Search and insert a formula.',
    'Cancel import': 'Stop importing this workbook.',
    'Cancel save': 'Close without saving the workbook.',
    Cancel: 'Close without applying changes.',
    'Open workbook action': 'Open the inspected workbook.',
    'Save As new file': 'Save the workbook to a new file.',
    'Clear contents (Delete)': 'Clear values but keep cell formatting.',
    'Copy (not available yet)': 'Copying is not available yet.',
    'Cut (not available yet)': 'Cutting is not available yet.',
    'Paste (not available yet)': 'Pasting is not available yet.',
    Rename: 'Confirm the worksheet name.',
    'Move selection up': 'Move the selected cell up.',
    'Move selection down': 'Move the selected cell down.',
    'Move selection left': 'Move the selected cell left.',
    'Move selection right': 'Move the selected cell right.',
    'Toggle touch range selection': 'Turn drag-to-select on or off.',
    'Select all visible cells': 'Select every visible cell.',
  },
  pl: {
    Plik: 'Pokaż polecenia plików skoroszytu.',
    Format: 'Pokaż polecenia formatowania komórek.',
    Cofnij: 'Cofnij ostatnią zmianę skoroszytu.',
    Ponów: 'Przywróć cofniętą zmianę skoroszytu.',
    Otwórz: 'Wybierz skoroszyt XLSX do otwarcia.',
    'Otwórz skoroszyt': 'Wybierz skoroszyt XLSX do otwarcia.',
    Zapisz: 'Zapisz bieżący skoroszyt.',
    'Zapisz jako': 'Zapisz kopię pod nową nazwą.',
    Nowy: 'Utwórz pusty skoroszyt.',
    'Nowy skoroszyt': 'Utwórz pusty skoroszyt.',
    'Zmniejsz liczbę miejsc dziesiętnych': 'Pokaż mniej miejsc dziesiętnych.',
    'Zwiększ liczbę miejsc dziesiętnych': 'Pokaż więcej miejsc dziesiętnych.',
    Pogrubienie: 'Pogrub tekst zaznaczonych komórek.',
    Kursywa: 'Pochyl tekst zaznaczonych komórek.',
    Podkreślenie: 'Podkreśl tekst zaznaczonych komórek.',
    'Zawijaj tekst': 'Zawijaj tekst w zaznaczonych komórkach.',
    'Wyczyść formaty': 'Usuń formatowanie zaznaczonych komórek.',
    'Funkcje formuł': 'Wyszukaj i wstaw formułę.',
    'Anuluj import': 'Zatrzymaj import tego skoroszytu.',
    'Anuluj zapis': 'Zamknij bez zapisywania skoroszytu.',
    Anuluj: 'Zamknij bez wprowadzania zmian.',
    'Zapisz jako nowy plik': 'Zapisz skoroszyt w nowym pliku.',
    'Wyczyść zawartość (Delete)': 'Usuń dane, zachowując formatowanie.',
    'Kopiowanie (jeszcze niedostępne)': 'Kopiowanie nie jest jeszcze dostępne.',
    'Wycinanie (jeszcze niedostępne)': 'Wycinanie nie jest jeszcze dostępne.',
    'Wklejanie (jeszcze niedostępne)': 'Wklejanie nie jest jeszcze dostępne.',
    'Zmień nazwę': 'Zatwierdź nazwę arkusza.',
    'Przesuń zaznaczenie w górę': 'Przesuń zaznaczoną komórkę w górę.',
    'Przesuń zaznaczenie w dół': 'Przesuń zaznaczoną komórkę w dół.',
    'Przesuń zaznaczenie w lewo': 'Przesuń zaznaczoną komórkę w lewo.',
    'Przesuń zaznaczenie w prawo': 'Przesuń zaznaczoną komórkę w prawo.',
    'Przełącz dotykowe zaznaczanie zakresu': 'Włącz lub wyłącz zaznaczanie przeciągnięciem.',
    'Zaznacz wszystkie widoczne komórki': 'Zaznacz wszystkie widoczne komórki.',
  },
}

export function getGridButtonTooltip(locale: Locale, label: string): string | undefined {
  return normalizeButtonTooltip(resolveGridButtonTooltip(locale, label))
}

function resolveGridButtonTooltip(locale: Locale, label: string): string | undefined {
  const normalized = label
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const direct = descriptions[locale][label] ?? descriptions[locale][normalized]
  if (direct) return direct

  if (locale === 'en') {
    const row = label.match(/^Insert (\d+) rows? above$/i)
    if (row) return `Insert ${row[1]} row${row[1] === '1' ? '' : 's'} above the selection.`
    const column = label.match(/^Insert (\d+) columns? before$/i)
    if (column) return `Insert ${column[1]} column${column[1] === '1' ? '' : 's'} before the selection.`
    if (/^Delete \d+ rows?$/i.test(label)) return 'Delete the selected worksheet rows.'
    if (/^Delete \d+ columns?$/i.test(label)) return 'Delete the selected worksheet columns.'
    if (/^Insert \S+ \(.+\)$/.test(label)) return undefined
    if (/^Resize column /i.test(label)) return 'Drag to change this column width.'
    if (/^Resize row /i.test(label)) return 'Drag to change this row height.'
  } else {
    const row = label.match(/^Wstaw (\d+) wiersz(?:e|y)? powyżej$/i)
    if (row) return `Wstaw ${row[1]} ${row[1] === '1' ? 'wiersz' : 'wiersze'} powyżej zaznaczenia.`
    const column = label.match(/^Wstaw (\d+) kolumn(?:ę|y) przed$/i)
    if (column) return `Wstaw ${rowOrColumnCount(column[1], 'kolumnę', 'kolumny')} przed zaznaczeniem.`
    if (/^Usuń \d+ wiersz/i.test(label)) return 'Usuń zaznaczone wiersze arkusza.'
    if (/^Usuń \d+ kolumn/i.test(label)) return 'Usuń zaznaczone kolumny arkusza.'
    if (/^Wstaw \S+ \(.+\)$/.test(label)) return undefined
    if (/^Zmień szerokość kolumny /i.test(label)) return 'Przeciągnij, aby zmienić szerokość kolumny.'
    if (/^Zmień wysokość wiersza /i.test(label)) return 'Przeciągnij, aby zmienić wysokość wiersza.'
  }
  return undefined
}

function rowOrColumnCount(count: string, singular: string, plural: string) {
  return count === '1' ? singular : plural
}

export function getGridSheetTabTooltip(locale: Locale, sheetName: string): string {
  return normalizeButtonTooltip(resolveGridSheetTabTooltip(locale, sheetName))!
}

function resolveGridSheetTabTooltip(locale: Locale, sheetName: string): string {
  return locale === 'pl'
    ? `Przejdź do arkusza „${sheetName}”. Dwuklik zmienia jego nazwę.`
    : `Switch to the ${sheetName} worksheet. Double-click to rename it.`
}
