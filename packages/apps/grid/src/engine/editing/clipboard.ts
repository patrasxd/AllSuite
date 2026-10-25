import { cellAddressKey, rangesOverlap } from '../workbook/address'
import { validateRange } from '../workbook/model'
import type { WorkbookSession } from '../workbook/session'
import type { CellAddress, CellRange, CellValue, Workbook, Worksheet } from '../workbook/types'

export type ValueBlock = Exclude<CellValue, { kind: 'formula' }>[][]
const MAX_CELLS = 10_000
const MAX_TEXT = 1_000_000

/** Metadata is usable only with a per-copy token from the same rich clipboard item. */
export function verifiedClipboardCopy<T extends { token: string; text: string; workbook: object }>(
  internal: T | null,
  token: string | null,
  text: string,
  workbook: object,
): internal is T {
  return (
    token !== null &&
    internal !== null &&
    internal.token === token &&
    internal.workbook === workbook &&
    internal.text.replaceAll('\r\n', '\n') === text.replaceAll('\r\n', '\n')
  )
}

function refuse(): never {
  throw new Error('Unsupported or unsafe values clipboard operation.')
}

function checkBlock(rows: ValueBlock): void {
  const width = rows[0]?.length ?? 0
  if (!width || !rows.length || width * rows.length > MAX_CELLS || rows.some((row) => row.length !== width)) refuse()
  for (const row of rows)
    for (const cell of row) {
      if (!['blank', 'number', 'boolean', 'string', 'date', 'error'].includes(cell.kind)) refuse()
      if (cell.kind === 'number' && !Number.isFinite(cell.value)) refuse()
      if (cell.kind === 'date' && !Number.isFinite(cell.serial)) refuse()
    }
}

export function checkClipboardRange(sheet: Worksheet, range: CellRange): void {
  validateRange(range)
  if ((range.end.row - range.start.row + 1) * (range.end.column - range.start.column + 1) > MAX_CELLS) refuse()
  if (range.end.row > sheet.dimensions.rowLimit || range.end.column > sheet.dimensions.columnLimit) refuse()
  if (sheet.merges.some((merge) => rangesOverlap(merge, range))) refuse()
}

/** Strict TSV; only unambiguous numbers/booleans are inferred. Equals and apostrophes are literal text. */
export function parseValuesTsv(text: string): ValueBlock {
  return parseDelimitedValues(text, '\t', 'scalars')
}

export type Delimiter = ',' | ';' | '\t'
export type DelimitedTyping = 'text' | 'scalars'

/** Shared clipboard/file grammar. Only file callers opt into BOM removal and text-only typing. */
export function parseDelimitedValues(text: string, delimiter: Delimiter, typing: DelimitedTyping): ValueBlock {
  if (text.length > MAX_TEXT) refuse()
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) refuse()
  }
  const fields: string[][] = [[]]
  let field = ''
  let quoted = false
  let closed = false
  let count = 0
  const finish = () => {
    fields.at(-1)!.push(field)
    if (++count > MAX_CELLS) refuse()
    field = ''
    closed = false
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
          closed = true
        }
      } else field += char
    } else if (char === delimiter || char === '\n' || char === '\r') {
      finish()
      if (char !== delimiter) {
        if (char === '\r' && text[i + 1] === '\n') i++
        if (i === text.length - 1) break
        fields.push([])
      }
    } else if (char === '"') {
      if (field || closed) refuse()
      quoted = true
    } else {
      if (closed) refuse()
      field += char
    }
    if (i === text.length - 1) finish()
  }
  if (quoted) refuse()
  if (!text.length) finish()
  const rows: ValueBlock = fields.map((row) =>
    row.map((value) => {
      if (value === '') return { kind: 'blank' }
      if (typing === 'text') return { kind: 'string', value }
      if (/^(true|false)$/i.test(value)) return { kind: 'boolean', value: value.toLowerCase() === 'true' }
      if (/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) {
        const number = Number(value)
        if (Number.isFinite(number) && (!Number.isInteger(number) || Number.isSafeInteger(number)))
          return { kind: 'number', value: number }
      }
      return { kind: 'string', value }
    }),
  )
  checkBlock(rows)
  return rows
}

export function valuesToTsv(rows: ValueBlock): string {
  return valuesToDelimited(rows, '\t')
}

export function valuesToDelimited(rows: ValueBlock, delimiter: Delimiter, file = false): string {
  checkBlock(rows)
  const text = rows
    .map((row, index) =>
      row
        .map((cell) => {
          const value =
            cell.kind === 'blank'
              ? ''
              : cell.kind === 'date'
                ? String(cell.serial)
                : cell.kind === 'error'
                  ? cell.code
                  : cell.kind === 'boolean'
                    ? cell.value
                      ? 'TRUE'
                      : 'FALSE'
                    : String(cell.value)
          // A final one-column blank must differ from an optional terminal line ending.
          return /[\t\r\n"]/.test(value) ||
            value.includes(delimiter) ||
            (file && cell.kind === 'string' && /^[\s]*[=+\-@]/.test(value)) ||
            (value === '' && row.length === 1 && index === rows.length - 1)
            ? `"${value.replaceAll('"', '""')}"`
            : value
        })
        .join(delimiter),
    )
    .join(file ? '\r\n' : '\n')
  if (text.length > MAX_TEXT) refuse()
  return text
}

export function copyValues(session: WorkbookSession, sheetId: string, ranges: CellRange[]): ValueBlock {
  if (ranges.length !== 1) refuse()
  const sheet = session.workbook.sheetsById.get(sheetId)
  if (!sheet || session.workbook.formulaStructureUnsafe) refuse()
  const range = ranges[0]
  checkClipboardRange(sheet, range)
  const rows: ValueBlock = []
  for (let row = range.start.row; row <= range.end.row; row++) {
    const values: ValueBlock[number] = []
    for (let column = range.start.column; column <= range.end.column; column++) {
      const value = sheet.cells.get(cellAddressKey({ row, column }))?.value ?? { kind: 'blank' as const }
      if (value.kind === 'formula') {
        if (value.formula.calculationStatus !== 'fresh' || value.formula.cachedResult.kind === 'error') refuse()
        values.push(structuredClone(value.formula.cachedResult))
      } else values.push(structuredClone(value))
    }
    rows.push(values)
  }
  valuesToTsv(rows)
  return rows
}

/** Prevalidate the entire target, then reuse the session's single atomic command/history. */
export function pasteValues(
  session: WorkbookSession,
  sheetId: string,
  start: CellAddress,
  rows: ValueBlock,
): CellRange {
  checkBlock(rows)
  valuesToTsv(rows)
  return pasteClipboardCells(session, sheetId, start, rows)
}

/** Shared destination safety policy; formula callers provide a fully validated detached plan. */
export function pasteClipboardCells(
  session: WorkbookSession,
  sheetId: string,
  start: CellAddress,
  rows: CellValue[][],
): CellRange {
  const range = { start, end: { row: start.row + rows.length - 1, column: start.column + rows[0].length - 1 } }
  checkClipboardDestination(session.workbook, sheetId, range)
  const changes = rows.flatMap((row, r) =>
    row.map((value, c) => ({
      address: { row: start.row + r, column: start.column + c },
      value: structuredClone(value),
    })),
  )
  session.setCells(sheetId, changes)
  return range
}

/** Identical preflight for both modes, also usable before asynchronous formula parsing. */
export function checkClipboardDestination(workbook: Workbook, sheetId: string, range: CellRange): void {
  const sheet = workbook.sheetsById.get(sheetId)
  if (!sheet || workbook.formulaStructureUnsafe) refuse()
  checkClipboardRange(sheet, range)
  for (let row = range.start.row; row <= range.end.row; row++)
    for (let column = range.start.column; column <= range.end.column; column++) {
      const value = sheet.cells.get(cellAddressKey({ row, column }))?.value
      if (value?.kind === 'formula' && value.formula.calculationStatus === 'unsupported') refuse()
    }
  if (
    workbook.preservation?.parts.some(
      (part) =>
        part.status === 'unsafe' ||
        ['blocked', 'at-risk', 'readable-not-editable'].includes(part.classification ?? '') ||
        (part.classification === 'preservable-opaque' &&
          part.dependsOn.some((impact) => impact === 'all' || impact === 'cell-values')),
    )
  )
    refuse()
  if (
    sheet.tables.some((table) =>
      rangesOverlap(range, {
        start: table.range.start,
        end: { row: table.range.start.row, column: table.range.end.column },
      }),
    )
  )
    refuse()
  if ([...sheet.validations, ...sheet.pivots].some((item) => rangesOverlap(item.range, range))) refuse()
}
