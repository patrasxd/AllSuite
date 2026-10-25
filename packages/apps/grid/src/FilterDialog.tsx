import { useState } from 'react'
import { Button, Dialog, Select } from '@all/ui'
import type { Locale } from './types'
import type { CellRange, FilterCriterion, Worksheet } from './engine/workbook/types'
import { columnNumberToName, formatRangeAddress, cellAddressKey } from './engine/workbook/address'
import { distinctFilterValues, filterLiteral } from './engine/workbook/filter'

export const FILTER_COPY = {
  en: {
    title: 'AutoFilter',
    active: 'AutoFilter active',
    column: 'Filter column',
    blank: '(Blanks)',
    all: 'Select all values',
    none: 'Deselect all values',
    clearColumn: 'Clear column criterion',
    apply: 'Apply filter',
    clear: 'Clear filter',
    cancel: 'Cancel',
    policy:
      'First row is the header. Select accepted literal values or blanks in each column. Columns combine with AND. Apply commits all changes; Cancel keeps the sheet unchanged. Clear filter removes all criteria and keeps manual hiding. Numbers and booleans with the same text share a choice.',
    refused:
      'Cannot filter this range. Select one header and literal data rectangle (up to 10,000 cells). Finish editing first. Formulas, dates, errors, hidden headers, merges, unsupported tables, objects, unsafe metadata and unsupported imported filters are not editable.',
  },
  pl: {
    title: 'Autofiltr',
    active: 'Autofiltr aktywny',
    column: 'Kolumna filtra',
    blank: '(Puste)',
    all: 'Zaznacz wszystkie wartości',
    none: 'Odznacz wszystkie wartości',
    clearColumn: 'Wyczyść kryterium kolumny',
    apply: 'Zastosuj filtr',
    clear: 'Wyczyść filtr',
    cancel: 'Anuluj',
    policy:
      'Pierwszy wiersz to nagłówek. Wybierz akceptowane wartości lub puste komórki w każdej kolumnie. Kolumny łączy warunek ORAZ. Zastosuj zatwierdza wszystkie zmiany; Anuluj pozostawia arkusz bez zmian. Wyczyść filtr usuwa kryteria, zachowując ręcznie ukryte wiersze. Liczby i wartości logiczne o tym samym tekście mają wspólny wybór.',
    refused:
      'Nie można filtrować zakresu. Zaznacz prostokąt z nagłówkiem i danymi (do 10 000 komórek). Najpierw zakończ edycję. Formuły, daty, błędy, ukryte nagłówki, scalenia, tabele, obiekty, niebezpieczne metadane i nieobsługiwane importowane filtry blokują operację.',
  },
}

export function FilterDialog({
  sheet,
  range,
  initialColumn,
  locale,
  onCancel,
  onApply,
}: {
  sheet: Worksheet
  range: CellRange
  initialColumn?: number
  locale: Locale
  onCancel: () => void
  onApply: (criteria: FilterCriterion[]) => void
}) {
  const copy = FILTER_COPY[locale]
  const [column, setColumn] = useState(initialColumn ?? range.start.column)
  const [criteria, setCriteria] = useState<FilterCriterion[]>(() => structuredClone(sheet.autoFilter?.criteria ?? []))
  const values = distinctFilterValues(sheet, range, column)
  const current = criteria.find((criterion) => criterion.column === column)
  const accepted = current ?? { column, values, blank: true }
  const change = (next: FilterCriterion) => setCriteria((old) => [...old.filter((c) => c.column !== column), next])
  return (
    <Dialog
      open
      title={copy.title}
      onClose={onCancel}
      closeLabel={copy.cancel}
      maxWidth="lg"
      className="grid-delimited-dialog grid-filter-dialog"
      description={
        locale === 'pl'
          ? 'Wybierz widoczne wartości. Pozostałe wiersze zostaną ukryte.'
          : 'Choose the values to show. Other rows are hidden.'
      }
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>
            {copy.cancel}
          </Button>
          <Button onClick={() => onApply(criteria)}>{copy.apply}</Button>
        </>
      }
    >
      <p>
        <strong>{locale === 'pl' ? 'Zakres' : 'Range'}</strong> · {formatRangeAddress(range)}
      </p>
      <Select
        label={copy.column}
        options={[]}
        aria-label={copy.column}
        value={column}
        onChange={(event) => setColumn(Number(event.currentTarget.value))}
      >
        {Array.from({ length: range.end.column - range.start.column + 1 }, (_, i) => range.start.column + i).map(
          (c) => (
            <option key={c} value={c}>
              {columnNumberToName(c)} —{' '}
              {filterLiteral(sheet.cells.get(cellAddressKey({ row: range.start.row, column: c }))?.value) ?? ''}
              {criteria.some((v) => v.column === c) ? ' •' : ''}
            </option>
          ),
        )}
      </Select>
      <div className="grid-filter-actions">
        <Button variant="outline" onClick={() => change({ column, values, blank: true })}>
          {copy.all}
        </Button>
        <Button variant="outline" onClick={() => change({ column, values: [], blank: false })}>
          {copy.none}
        </Button>
        <Button variant="outline" onClick={() => setCriteria((old) => old.filter((c) => c.column !== column))}>
          {copy.clearColumn}
        </Button>
      </div>
      <details className="grid-dialog-policy">
        <summary>{locale === 'pl' ? 'Zasady filtrowania' : 'Filter details'}</summary>
        <p>{copy.policy}</p>
      </details>
      <div className="grid-filter-values" role="group" aria-label={copy.column}>
        <label>
          <input
            type="checkbox"
            checked={accepted.blank}
            onChange={(event) => change({ ...accepted, blank: event.currentTarget.checked })}
          />
          {copy.blank}
        </label>
        {values.map((value) => (
          <label key={value}>
            <input
              type="checkbox"
              checked={accepted.values.includes(value)}
              onChange={(event) =>
                change({
                  ...accepted,
                  values: event.currentTarget.checked
                    ? [...accepted.values, value]
                    : accepted.values.filter((v) => v !== value),
                })
              }
            />
            {value}
          </label>
        ))}
      </div>
    </Dialog>
  )
}
