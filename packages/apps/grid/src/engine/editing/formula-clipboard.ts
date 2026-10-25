import { cellAddressKey } from '../workbook/address'
import type { WorkbookSession } from '../workbook/session'
import type { CellAddress, CellRange, CellValue, Workbook } from '../workbook/types'
import { checkClipboardRange, checkClipboardDestination, pasteClipboardCells, valuesToTsv } from './clipboard'
import { transformCopyExpression } from '../formulas/row-transform'
import { FORMULA_RESOURCE_LIMITS } from '../formulas/policy'

export interface FormulaCopy {
  sheetId: string
  start: CellAddress
  rows: CellValue[][]
}

/** Snapshot values only; no styles, live source reads or cross-workbook relocation. */
export function copyFormulas(session: WorkbookSession, sheetId: string, ranges: CellRange[]): FormulaCopy {
  const sheet = session.workbook.sheetsById.get(sheetId)
  if (!sheet || ranges.length !== 1 || session.workbook.formulaStructureUnsafe || session.workbook.definedNames.length)
    throw new Error('Unsupported formula copy.')
  if (
    session.workbook.preservation?.parts.some((part) => part.classification !== 'supported' || part.status === 'unsafe')
  )
    throw new Error('Imported formula metadata cannot be safely copied.')
  const range = ranges[0]
  checkClipboardRange(sheet, range)
  const rows: CellValue[][] = []
  for (let row = range.start.row; row <= range.end.row; row++) {
    const cells: CellValue[] = []
    for (let column = range.start.column; column <= range.end.column; column++) {
      const value = sheet.cells.get(cellAddressKey({ row, column }))?.value ?? { kind: 'blank' }
      if (value.kind === 'formula' && !['fresh', 'error'].includes(value.formula.calculationStatus))
        throw new Error('Only verified scalar formulas can be copied.')
      cells.push(structuredClone(value))
    }
    rows.push(cells)
  }
  const payload = { sheetId, start: { ...range.start }, rows }
  formulaCopyText(payload)
  return payload
}

/** Plain text is an inert representation. It can never authorize formula-source paste. */
export function formulaCopyText(payload: FormulaCopy): string {
  return valuesToTsv(
    payload.rows.map((row) =>
      row.map((value) =>
        value.kind === 'formula'
          ? { kind: 'string', value: value.formula.canonicalExpression || value.formula.source }
          : value,
      ),
    ),
  )
}

export async function prepareFormulaPaste(
  workbook: Workbook,
  sheetId: string,
  start: CellAddress,
  payload: FormulaCopy,
): Promise<CellValue[][]> {
  const sheet = workbook.sheetsById.get(sheetId)
  if (
    !sheet ||
    !workbook.sheetsById.has(payload.sheetId) ||
    workbook.formulaStructureUnsafe ||
    workbook.definedNames.length
  )
    throw new Error('Unsupported formula destination.')
  formulaCopyText(payload) // Same rectangular, size and literal-kind limits as PP01.
  checkClipboardDestination(workbook, sheetId, {
    start,
    end: { row: start.row + payload.rows.length - 1, column: start.column + payload.rows[0].length - 1 },
  })
  const rows = structuredClone(payload.rows)
  let count = 0
  for (const row of rows)
    for (const value of row) {
      if (value.kind !== 'formula') continue
      if (
        ++count > FORMULA_RESOURCE_LIMITS.formulaCells ||
        !['fresh', 'error'].includes(value.formula.calculationStatus)
      )
        throw new Error('Unsupported formula payload.')
      const transformed = await transformCopyExpression(
        value.formula.canonicalExpression || value.formula.source,
        workbook,
        sheetId,
        {
          row: start.row - payload.start.row,
          column: start.column - payload.start.column,
        },
      )
      value.formula = {
        ...value.formula,
        source: transformed.expression,
        canonicalExpression: transformed.expression,
        ast: transformed.ast,
        cachedResult: { kind: 'blank' },
        calculationStatus: 'stale',
      }
    }
  return rows
}

export function pasteFormulaBlock(session: WorkbookSession, sheetId: string, start: CellAddress, rows: CellValue[][]) {
  return pasteClipboardCells(session, sheetId, start, rows)
}
