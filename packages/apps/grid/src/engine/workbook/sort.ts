import { cellAddressKey, rangesOverlap } from './address'
import { validateRange } from './model'
import type { Cell, CellRange, CellValue, Workbook, Worksheet } from './types'

export interface SortOptions {
  range: CellRange
  keyColumn: number
  direction: 'ascending' | 'descending'
  headers: boolean
}

// Fixed Polish collation in both UI languages. Diacritics and case participate;
// numeric-looking text remains text. Original indices resolve all equal keys.
const collator = new Intl.Collator('pl-PL', { usage: 'sort', sensitivity: 'variant', numeric: false })
const blank = (value?: CellValue) => !value || value.kind === 'blank' || (value.kind === 'string' && value.value === '')

function compare(
  left: CellValue | undefined,
  right: CellValue | undefined,
  direction: SortOptions['direction'],
): number {
  if (blank(left) || blank(right)) return Number(blank(left)) - Number(blank(right))
  const rank = (value?: CellValue) => (value?.kind === 'number' ? 0 : value?.kind === 'string' ? 1 : 2)
  let result = rank(left) - rank(right)
  if (!result && left?.kind === 'number' && right?.kind === 'number') result = left.value - right.value
  if (!result && left?.kind === 'string' && right?.kind === 'string') result = collator.compare(left.value, right.value)
  if (!result && left?.kind === 'boolean' && right?.kind === 'boolean')
    result = Number(left.value) - Number(right.value)
  return direction === 'ascending' ? result : -result
}

/** Validate all dependencies before constructing a permutation; never mutates the model. */
export function sortedRangeCells(workbook: Workbook, sheet: Worksheet, options: SortOptions): Map<string, Cell> {
  const { range, keyColumn, direction, headers } = options
  validateRange(range)
  const rows = range.end.row - range.start.row + 1
  const columns = range.end.column - range.start.column + 1
  if (
    rows - Number(headers) < 2 ||
    rows * columns > 10_000 ||
    range.end.row > sheet.dimensions.rowLimit ||
    range.end.column > sheet.dimensions.columnLimit ||
    !Number.isInteger(keyColumn) ||
    keyColumn < range.start.column ||
    keyColumn > range.end.column ||
    !['ascending', 'descending'].includes(direction) ||
    typeof headers !== 'boolean'
  )
    throw new Error('Invalid sort range or options.')
  if (
    workbook.formulaStructureUnsafe ||
    workbook.definedNames.length ||
    workbook.preservation?.parts.some((part) => part.classification !== 'supported' || part.status !== 'safe')
  )
    throw new Error('Unsupported workbook dependencies.')
  for (const item of workbook.sheetsById.values()) {
    if (
      [...item.cells.values()].some((cell) => cell.value.kind === 'formula') ||
      item.tables.length ||
      item.drawings.length ||
      item.pivots.length ||
      item.validations.length ||
      item.conditionalFormats.length ||
      item.autoFilter ||
      item.comments?.length ||
      item.hyperlinks?.length ||
      item.printSettings
    )
      throw new Error('Unsupported workbook dependencies.')
  }
  if (
    sheet.merges.some((merge) => rangesOverlap(merge, range)) ||
    [...sheet.rowMetadata].some(
      ([row, meta]) =>
        row >= range.start.row && row <= range.end.row && (meta.hidden || meta.outlineLevel || meta.style),
    ) ||
    [...sheet.columnMetadata].some(
      ([column, meta]) =>
        column >= range.start.column && column <= range.end.column && (meta.hidden || meta.outlineLevel || meta.style),
    )
  )
    throw new Error('Unsupported range dependencies.')
  const first = range.start.row + Number(headers)
  const order = Array.from({ length: range.end.row - first + 1 }, (_, index) => first + index)
  for (let row = range.start.row; row <= range.end.row; row++) {
    for (let column = range.start.column; column <= range.end.column; column++) {
      const value = sheet.cells.get(cellAddressKey({ row, column }))?.value
      if (
        value &&
        (!['blank', 'number', 'string', 'boolean'].includes(value.kind) ||
          (value.kind === 'number' && !Number.isFinite(value.value)))
      )
        throw new Error('Only ordinary literal cells can be sorted.')
    }
  }
  order.sort(
    (left, right) =>
      compare(
        sheet.cells.get(cellAddressKey({ row: left, column: keyColumn }))?.value,
        sheet.cells.get(cellAddressKey({ row: right, column: keyColumn }))?.value,
        direction,
      ) || left - right,
  )
  const cells = new Map(sheet.cells)
  order.forEach((sourceRow, index) => {
    for (let column = range.start.column; column <= range.end.column; column++) {
      const target = cellAddressKey({ row: first + index, column })
      const cell = sheet.cells.get(cellAddressKey({ row: sourceRow, column }))
      if (cell) cells.set(target, structuredClone(cell))
      else cells.delete(target)
    }
  })
  return cells
}
