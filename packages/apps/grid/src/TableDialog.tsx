import { useState } from 'react'
import { Button, Dialog, Input } from '@all/ui'
import type { Locale } from './types'
import type { CellRange, Worksheet } from './engine/workbook/types'
import { cellAddressKey, formatRangeAddress } from './engine/workbook/address'
import { formatCellDisplay } from './engine/editing/cell-input'
import { validTableName } from './engine/workbook/table'

export const TABLE_COPY = {
  en: {
    group: 'Tables',
    selectionHelp:
      'Select one rectangular range with a row of unique text headers and at least one data row (up to 10,000 cells). Finish editing the cell first. Press Escape in the grid to return to the toolbar.',
    convertHelp: 'Remove the selected table and its filter while keeping cell data and formatting.',
    create: 'Create Table',
    convert: 'Convert to Range',
    name: 'Table name',
    cancel: 'Cancel',
    policy:
      'Use an existing header row with unique text labels and literal data (up to 10,000 cells). One fixed table per sheet. Table names use letters, digits and underscores, start with a letter or underscore, and cannot be cell references.',
    refused:
      'Cannot create or convert this table. Check the name, unique text headers and selection. Existing filters, tables, formulas, objects or protected imported metadata may prevent this operation.',
  },
  pl: {
    group: 'Tabele',
    selectionHelp:
      'Zaznacz jeden prostokątny zakres z wierszem unikatowych nagłówków tekstowych i co najmniej jednym wierszem danych (do 10 000 komórek). Najpierw zakończ edycję komórki. Naciśnij Escape w siatce, aby wrócić do paska narzędzi.',
    convertHelp: 'Usuń zaznaczoną tabelę i jej filtr, zachowując dane i formatowanie komórek.',
    create: 'Utwórz tabelę',
    convert: 'Konwertuj na zakres',
    name: 'Nazwa tabeli',
    cancel: 'Anuluj',
    policy:
      'Użyj istniejącego wiersza unikatowych nagłówków tekstowych i danych (do 10 000 komórek). Jedna tabela o stałym zakresie na arkusz. Nazwa zaczyna się literą lub podkreśleniem, zawiera litery, cyfry i podkreślenia; nie może być adresem komórki.',
    refused:
      'Nie można utworzyć ani przekonwertować tabeli. Sprawdź nazwę, unikatowe nagłówki tekstowe i zaznaczenie. Istniejące filtry, tabele, formuły, obiekty lub chronione metadane mogą blokować operację.',
  },
}
export function TableDialog({
  range,
  sheet,
  dateSystem,
  locale,
  onCancel,
  onCreate,
}: {
  range: CellRange
  sheet: Worksheet
  dateSystem: '1900' | '1904'
  locale: Locale
  onCancel: () => void
  onCreate: (name: string) => boolean
}) {
  const copy = TABLE_COPY[locale]
  const [name, setName] = useState('Table1')
  const [error, setError] = useState(false)
  const nameError =
    error && !validTableName(name)
      ? locale === 'pl'
        ? 'Użyj liter, cyfr i podkreśleń. Zacznij literą lub podkreśleniem; nie używaj adresu komórki. Maksymalnie 255 znaków.'
        : 'Use letters, digits and underscores. Start with a letter or underscore; avoid cell addresses. Maximum 255 characters.'
      : undefined
  return (
    <Dialog
      open
      title={copy.create}
      onClose={onCancel}
      closeLabel={copy.cancel}
      className="grid-delimited-dialog"
      maxWidth="lg"
      description={
        locale === 'pl'
          ? 'Uporządkuj zaznaczenie z nagłówkami i pasami wierszy.'
          : 'Organize your selection with headers and row banding.'
      }
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>
            {copy.cancel}
          </Button>
          <Button onClick={() => setError(!onCreate(name))}>{copy.create}</Button>
        </>
      }
    >
      <div className="grid-dialog-fields">
        <Input label={locale === 'pl' ? 'Zakres' : 'Range'} value={formatRangeAddress(range)} readOnly tabIndex={-1} />
        <Input
          label={copy.name}
          aria-label={copy.name}
          error={nameError}
          value={name}
          onChange={(event) => {
            setName(event.currentTarget.value)
            setError(false)
          }}
        />
      </div>
      {error && !nameError && <p role="alert">{copy.refused}</p>}
      <strong>
        {locale === 'pl' ? 'Podgląd · pierwszy wiersz to nagłówki' : 'Preview · first row used as headers'}
      </strong>
      {/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- The read-only scroll region needs keyboard access to offscreen preview columns. */}
      <div
        className="grid-delimited-preview"
        tabIndex={0}
        role="region"
        aria-label={locale === 'pl' ? 'Podgląd tabeli' : 'Table preview'}
      >
        <table>
          <tbody>
            {Array.from({ length: Math.min(4, range.end.row - range.start.row + 1) }, (_, row) => (
              <tr key={row}>
                {Array.from({ length: Math.min(10, range.end.column - range.start.column + 1) }, (_, column) => {
                  const cell = sheet.cells.get(
                    cellAddressKey({ row: range.start.row + row, column: range.start.column + column }),
                  )
                  return row === 0 ? (
                    <th key={column} scope="col">
                      {formatCellDisplay(cell, locale, dateSystem)}
                    </th>
                  ) : (
                    <td key={column}>{formatCellDisplay(cell, locale, dateSystem)}</td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* eslint-enable jsx-a11y/no-noninteractive-tabindex */}
      <details className="grid-dialog-policy">
        <summary>{locale === 'pl' ? 'Wymagania tabeli' : 'Table requirements'}</summary>
        <p>{copy.policy}</p>
      </details>
    </Dialog>
  )
}
