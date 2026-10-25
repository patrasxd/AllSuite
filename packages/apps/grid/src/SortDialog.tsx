import { useState } from 'react'
import { Button, Dialog, Select } from '@all/ui'
import type { Locale } from './types'
import type { CellRange } from './engine/workbook'
import type { SortOptions } from './engine/workbook/sort'
import { columnNumberToName, formatRangeAddress } from './engine/workbook/address'

export const SORT_COPY = {
  en: {
    title: 'Sort range',
    column: 'Sort column',
    direction: 'Sort order',
    headers: 'First row contains headers',
    yes: 'Yes — keep first row fixed',
    no: 'No — sort all rows',
    ascending: 'Ascending',
    descending: 'Descending',
    apply: 'Apply sort',
    cancel: 'Cancel',
    policy:
      'Whole selected rows move with their cell formatting. Numbers, then text (Polish locale, case and diacritics), then booleans. Blanks always last. Equal keys keep their order. Only ordinary literal ranges are supported; formulas anywhere in the workbook, filters, tables, objects and unsupported metadata prevent sorting.',
    refused:
      'Cannot sort this selection. Select one ordinary rectangular literal range (up to 10,000 cells), with at least two data rows. Finish editing first. Formulas anywhere in the workbook, affected merges, filters, hidden/grouped data, tables, objects and unsupported metadata are not supported.',
  },
  pl: {
    title: 'Sortuj zakres',
    column: 'Kolumna sortowania',
    direction: 'Kolejność sortowania',
    headers: 'Pierwszy wiersz zawiera nagłówki',
    yes: 'Tak — pozostaw pierwszy wiersz',
    no: 'Nie — sortuj wszystkie wiersze',
    ascending: 'Rosnąco',
    descending: 'Malejąco',
    apply: 'Zastosuj sortowanie',
    cancel: 'Anuluj',
    policy:
      'Całe zaznaczone wiersze są przenoszone z formatowaniem komórek. Liczby, tekst (polska kolejność, wielkość liter i znaki diakrytyczne), wartości logiczne. Puste zawsze na końcu. Równe klucze zachowują kolejność. Tylko zwykłe zakresy danych: formuły w skoroszycie, filtry, tabele, obiekty i nieobsługiwane metadane blokują sortowanie.',
    refused:
      'Nie można posortować zaznaczenia. Wybierz jeden prostokątny zakres danych (do 10 000 komórek) z co najmniej dwoma wierszami danych. Najpierw zakończ edycję. Formuły w skoroszycie, scalenia w zakresie, filtry, ukryte lub zgrupowane dane, tabele, obiekty i nieobsługiwane metadane nie są obsługiwane.',
  },
}

export function SortDialog({
  range,
  locale,
  onCancel,
  onApply,
}: {
  range: CellRange
  locale: Locale
  onCancel: () => void
  onApply: (options: SortOptions) => void
}) {
  const copy = SORT_COPY[locale]
  const [keyColumn, setKeyColumn] = useState(range.start.column)
  const [direction, setDirection] = useState<SortOptions['direction']>('ascending')
  const [headers, setHeaders] = useState(false)
  return (
    <Dialog
      open
      title={copy.title}
      onClose={onCancel}
      closeLabel={copy.cancel}
      maxWidth="lg"
      className="grid-delimited-dialog grid-sort-dialog"
      description={
        locale === 'pl'
          ? 'Zmień kolejność całych rekordów według jednej kolumny.'
          : 'Reorder whole records by one column.'
      }
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>
            {copy.cancel}
          </Button>
          <Button onClick={() => onApply({ range, keyColumn, direction, headers })}>{copy.apply}</Button>
        </>
      }
    >
      <p>
        <strong>{locale === 'pl' ? 'Zakres' : 'Range'}</strong> · {formatRangeAddress(range)}
      </p>
      <div className="grid-delimited-controls">
        <Select
          label={copy.column}
          options={[]}
          aria-label={copy.column}
          value={keyColumn}
          onChange={(event) => setKeyColumn(Number(event.currentTarget.value))}
        >
          {Array.from(
            { length: range.end.column - range.start.column + 1 },
            (_, index) => range.start.column + index,
          ).map((column) => (
            <option key={column} value={column}>
              {columnNumberToName(column)}
            </option>
          ))}
        </Select>
        <Select
          label={copy.direction}
          options={[]}
          aria-label={copy.direction}
          value={direction}
          onChange={(event) => setDirection(event.currentTarget.value as SortOptions['direction'])}
        >
          <option value="ascending">{copy.ascending}</option>
          <option value="descending">{copy.descending}</option>
        </Select>
        <Select
          label={copy.headers}
          options={[]}
          aria-label={copy.headers}
          value={headers ? 'yes' : 'no'}
          onChange={(event) => setHeaders(event.currentTarget.value === 'yes')}
        >
          <option value="no">{copy.no}</option>
          <option value="yes">{copy.yes}</option>
        </Select>
      </div>
      <details className="grid-dialog-policy">
        <summary>{locale === 'pl' ? 'Zasady sortowania' : 'Sort details'}</summary>
        <p>{copy.policy}</p>
      </details>
    </Dialog>
  )
}
