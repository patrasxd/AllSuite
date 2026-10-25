import { cellAddressKey, rangesOverlap } from './address'
import { validateRange } from './model'
import { filteredRows } from './filter'
import type { CellRange, TableDescriptor, Workbook, Worksheet } from './types'

export function validTableName(name: string): boolean {
  return (
    name.length <= 255 &&
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) &&
    !/^(?:[A-Za-z]{1,3}[1-9][0-9]*|R[0-9]*C[0-9]*|R|C)$/i.test(name)
  )
}
export function validHeader(name: string): boolean {
  return Boolean(name.trim()) && name.length <= 255 && validTableText(name)
}
export function validTableText(name: string): boolean {
  return ![...name].some((char) => {
    const code = char.codePointAt(0)!
    return (
      (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
      (code >= 0xd800 && code <= 0xdfff) ||
      code === 0xfffe ||
      code === 0xffff
    )
  })
}
export function validateTableContext(workbook: Workbook, sheet: Worksheet) {
  if (
    workbook.formulaStructureUnsafe ||
    workbook.definedNames.length ||
    sheet.drawings.length ||
    sheet.pivots.length ||
    sheet.comments?.length ||
    sheet.validations.length ||
    sheet.conditionalFormats.length ||
    sheet.hyperlinks?.length ||
    workbook.preservation?.parts.some(
      (p) =>
        p.classification !== 'supported' ||
        (p.status !== 'safe' &&
          (!p.invalidatedBy?.length ||
            p.invalidatedBy.some((i) => !['cell-values', 'cell-styles', 'row-visibility'].includes(i)))),
    ) ||
    [...workbook.sheetsById.values()].some(
      (s) =>
        [...s.cells.values()].some((c) => c.value.kind === 'formula') || s.tables.some((t) => t.ownership !== 'simple'),
    )
  )
    throw new Error('Unsupported workbook metadata for native table authoring.')
}
export function planSimpleTable(workbook: Workbook, sheet: Worksheet, range: CellRange, name: string): TableDescriptor {
  validateRange(range)
  validateTableContext(workbook, sheet)
  if (
    !validTableName(name) ||
    [...workbook.sheetsById.values()].some((s) => s.tables.some((t) => t.name.toLowerCase() === name.toLowerCase())) ||
    sheet.tables.length ||
    sheet.autoFilter ||
    sheet.merges.some((m) => rangesOverlap(m, range))
  )
    throw new Error('Invalid table name, overlap or filter ownership.')
  filteredRows(workbook, sheet, range, [])
  for (let row = range.start.row + 1; row <= range.end.row; row++)
    for (let column = range.start.column; column <= range.end.column; column++) {
      const value = sheet.cells.get(cellAddressKey({ row, column }))?.value
      if (value?.kind === 'string' && !validTableText(value.value)) throw new Error('Invalid XML table literal.')
    }
  const names: string[] = []
  for (let column = range.start.column; column <= range.end.column; column++) {
    const value = sheet.cells.get(cellAddressKey({ row: range.start.row, column }))?.value
    if (
      value?.kind !== 'string' ||
      !validHeader(value.value) ||
      names.some((n) => n.toLowerCase() === value.value.toLowerCase())
    )
      throw new Error('Table headers must be unique nonempty text.')
    names.push(value.value)
  }
  const used = new Set([...workbook.sheetsById.values()].flatMap((s) => s.tables.map((t) => t.nativeId)))
  let nativeId = 1
  while (
    used.has(nativeId) ||
    workbook.preservation?.parts.some((p) => p.partName === `xl/tables/table${nativeId}.xml`)
  )
    nativeId++
  return {
    id: `xl/tables/table${nativeId}.xml`,
    nativeId,
    ownership: 'simple',
    name,
    range: structuredClone(range),
    columns: names.map((name, i) => ({ id: String(i + 1), name })),
    styleName: 'TableStyleMedium2',
    autoFilter: true,
    rangeStatus: 'safe',
  }
}
