import { cellAddressKey, rangesOverlap } from './address'
import { validateRange } from './model'
import { isDateFormat } from './dates'
import type { CellRange, CellValue, FilterCriterion, RowMetadata, Workbook, Worksheet } from './types'

export const FILTER_NAMESPACE = 'urn:allsuite:grid:row-visibility:1'
export const isRowHidden = (sheet: Worksheet, row: number) => {
  const metadata = sheet.rowMetadata.get(row)
  return Boolean(metadata?.hidden || metadata?.filterHidden)
}

export function filterLiteral(value?: CellValue): string | null {
  if (!value || value.kind === 'blank' || (value.kind === 'string' && value.value === '')) return null
  if (value.kind === 'string') return value.value
  if (value.kind === 'number' && Number.isFinite(value.value)) return String(value.value)
  if (value.kind === 'boolean') return value.value ? '1' : '0'
  throw new Error('Only ordinary literal filter values are supported.')
}

export function distinctFilterValues(sheet: Worksheet, range: CellRange, column: number): string[] {
  const values = new Set<string>()
  for (let row = range.start.row + 1; row <= range.end.row; row++) {
    const value = filterLiteral(sheet.cells.get(cellAddressKey({ row, column }))?.value)
    if (value !== null) values.add(value)
  }
  return [...values]
}

/** Pure planner: validate the entire operation before history or model mutation. */
export function filteredRows(
  workbook: Pick<Workbook, 'formulaStructureUnsafe' | 'preservation'>,
  sheet: Worksheet,
  range: CellRange,
  criteria: FilterCriterion[],
) {
  validateRange(range)
  if (
    range.end.row <= range.start.row ||
    (range.end.row - range.start.row + 1) * (range.end.column - range.start.column + 1) > 10_000 ||
    range.end.row > sheet.dimensions.rowLimit ||
    range.end.column > sheet.dimensions.columnLimit ||
    sheet.autoFilter?.unsupported ||
    (sheet.autoFilter && !sheet.autoFilter.criteria) ||
    (sheet.autoFilter && JSON.stringify(sheet.autoFilter.range) !== JSON.stringify(range)) ||
    sheet.rowMetadata.get(range.start.row)?.hidden ||
    sheet.merges.some((merge) => rangesOverlap(merge, range)) ||
    workbook.formulaStructureUnsafe ||
    workbook.preservation?.parts.some(
      (part) =>
        part.classification !== 'supported' ||
        (part.status !== 'safe' &&
          (!part.invalidatedBy?.length ||
            part.invalidatedBy.some((impact) => !['cell-values', 'cell-styles', 'row-visibility'].includes(impact)))),
    ) ||
    sheet.tables.some(
      (table) => table.ownership !== 'simple' || JSON.stringify(table.range) !== JSON.stringify(range),
    ) ||
    sheet.drawings.length ||
    sheet.pivots.length
  )
    throw new Error('Unsupported filter range or workbook metadata.')
  const columns = new Set<number>()
  for (const criterion of criteria) {
    if (
      !Number.isInteger(criterion.column) ||
      criterion.column < range.start.column ||
      criterion.column > range.end.column ||
      columns.has(criterion.column) ||
      typeof criterion.blank !== 'boolean' ||
      !Array.isArray(criterion.values) ||
      criterion.values.some(
        (value) =>
          typeof value !== 'string' ||
          value === '' ||
          [...value].some((char) => {
            const code = char.codePointAt(0)!
            return (
              (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
              (code >= 0xd800 && code <= 0xdfff) ||
              code === 0xfffe ||
              code === 0xffff
            )
          }),
      ) ||
      new Set(criterion.values).size !== criterion.values.length
    )
      throw new Error('Invalid filter criteria.')
    columns.add(criterion.column)
  }
  for (let row = range.start.row; row <= range.end.row; row++) {
    for (let column = range.start.column; column <= range.end.column; column++) {
      const cell = sheet.cells.get(cellAddressKey({ row, column }))
      if (cell?.value.kind === 'number' && isDateFormat(cell.style?.numberFormat ?? 'General'))
        throw new Error('Date-formatted filter values are not supported.')
      filterLiteral(cell?.value)
    }
  }
  return evaluateFilterRows(sheet, range, criteria)
}

export function evaluateFilterRows(sheet: Worksheet, range: CellRange, criteria: FilterCriterion[]) {
  const rows = new Map<number, RowMetadata>()
  for (const [row, metadata] of sheet.rowMetadata) {
    const { filterHidden: _filterHidden, ...manual } = metadata
    if (Object.keys(manual).length) rows.set(row, manual)
  }
  for (let row = range.start.row + 1; row <= range.end.row; row++) {
    if (
      !criteria.every((criterion) => {
        const value = filterLiteral(sheet.cells.get(cellAddressKey({ row, column: criterion.column }))?.value)
        return value === null ? criterion.blank : criterion.values.includes(value)
      })
    )
      rows.set(row, { ...rows.get(row), filterHidden: true })
  }
  return rows
}

/** Skip hidden rows for arrows, tab, name-box jumps and touch navigation. */
export function visibleRow(sheet: Worksheet, row: number, direction: number): number {
  const step = direction < 0 ? -1 : 1
  let next = row
  while (next >= 1 && next <= sheet.dimensions.rowLimit && isRowHidden(sheet, next)) next += step
  if (next >= 1 && next <= sheet.dimensions.rowLimit) return next
  next = row
  while (next >= 1 && next <= sheet.dimensions.rowLimit && isRowHidden(sheet, next)) next -= step
  return Math.max(1, Math.min(sheet.dimensions.rowLimit, next))
}
