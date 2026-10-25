import { useMemo, useState } from 'react'
import { Button, Dialog, Select } from '@all/ui'
import { DELIMITED_COPY } from './delimited-copy'
import type { Locale } from './types'
import type { Workbook } from './engine/workbook'
import { cellAddressKey } from './engine/workbook/address'
import { prepareDelimitedWorkbook } from './engine/editing/delimited'
import type { Delimiter, DelimitedTyping } from './engine/editing/clipboard'
import { formatCellDisplay } from './engine/editing/cell-input'

export function DelimitedPreview({
  file,
  locale,
  onCancel,
  onImport,
}: {
  file: { name: string; text: string }
  locale: Locale
  onCancel: () => void
  onImport: (workbook: Workbook) => void
}) {
  const copy = DELIMITED_COPY[locale]
  const [delimiter, setDelimiter] = useState<Delimiter>(/\.tsv$/i.test(file.name) ? '\t' : ',')
  const [skip, setSkip] = useState(false)
  const [typing, setTyping] = useState<DelimitedTyping>('text')
  const workbook = useMemo(() => {
    try {
      return prepareDelimitedWorkbook(file.text, delimiter, skip, typing)
    } catch {
      return null
    }
  }, [file.text, delimiter, skip, typing])
  const sheet = workbook?.sheetsById.get(workbook.activeSheetId)
  const rows = Math.min(20, sheet?.dimensions.usedRange?.end.row ?? 1)
  const columns = Math.min(10, sheet?.dimensions.usedRange?.end.column ?? 1)
  return (
    <Dialog
      open
      title={copy.preview}
      onClose={onCancel}
      closeLabel={copy.cancel}
      maxWidth="lg"
      className="grid-delimited-dialog"
      description={
        locale === 'pl'
          ? 'Sprawdź dane przed importem do nowego skoroszytu.'
          : 'Check how your file will be read before importing.'
      }
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>
            {copy.cancel}
          </Button>
          <Button disabled={!workbook} onClick={() => workbook && onImport(workbook)}>
            {copy.accept}
          </Button>
        </>
      }
    >
      <p>{file.name}</p>
      <div className="grid-delimited-controls">
        <Select
          label={copy.delimiter}
          options={[]}
          aria-label={copy.delimiter}
          value={delimiter}
          onChange={(event) => setDelimiter(event.currentTarget.value as Delimiter)}
        >
          <option value=",">{copy.comma}</option>
          <option value=";">{copy.semicolon}</option>
          <option value={'\t'}>{copy.tab}</option>
        </Select>
        <Select
          label={copy.header}
          options={[]}
          aria-label={copy.header}
          value={skip ? 'skip' : 'keep'}
          onChange={(event) => setSkip(event.currentTarget.value === 'skip')}
        >
          <option value="keep">{copy.keep}</option>
          <option value="skip">{copy.skip}</option>
        </Select>
        <Select
          label={copy.typing}
          options={[]}
          aria-label={copy.typing}
          value={typing}
          onChange={(event) => setTyping(event.currentTarget.value as DelimitedTyping)}
        >
          <option value="text">{copy.text}</option>
          <option value="scalars">{copy.scalars}</option>
        </Select>
      </div>
      {!workbook && <p role="alert">{copy.invalid}</p>}
      {sheet && workbook && (
        <div className="grid-delimited-preview">
          <table aria-label={copy.preview}>
            <tbody>
              {Array.from({ length: rows }, (_, row) => (
                <tr key={row}>
                  {Array.from({ length: columns }, (_, column) => {
                    const address = cellAddressKey({ row: row + 1, column: column + 1 })
                    const cell = sheet.cells.get(address)
                    return <td key={column}>{formatCellDisplay(cell, locale, workbook.dateSystem)}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <details className="grid-dialog-policy">
        <summary>{locale === 'pl' ? 'Szczegóły importu' : 'Import details'}</summary>
        <p>{copy.policy}</p>
      </details>
    </Dialog>
  )
}
