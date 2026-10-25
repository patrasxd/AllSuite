import type { ASTNodeData } from 'formualizer'
import { FormulaRuntime, parseStructuralFormula } from './runtime'
import { createFormulaWorkbookSnapshot } from './types'
import { FORMULA_RESOURCE_LIMITS } from './policy'
import {
  formatRangeAddress,
  formatSheetQualifiedAddress,
  parseRangeAddress,
  parseSheetQualifiedAddress,
} from '../workbook/address'
import {
  MAX_ROWS,
  MAX_COLUMNS,
  type Cell,
  type CellAddress,
  type CellRange,
  type FormulaAstNode,
  type Workbook,
} from '../workbook/types'

export interface StructuralOperation {
  /** Omitted by existing PP02 callers. Structural movement is identical on either axis. */
  axis?: 'row' | 'column'
  sheetId: string
  start: number
  count: number
  insert: boolean
}
export type StructuralFormulaCells = Map<string, Map<string, Cell>>

/** Structural movement moves absolute and relative references alike. Copy offsets are deliberately unrelated. */
function moveRange(range: CellRange, operation: StructuralOperation, copyOffset?: CellAddress): CellRange | undefined {
  if (copyOffset) {
    const offset = (address: CellAddress): CellAddress => ({
      ...address,
      row: address.row + (address.absoluteRow ? 0 : copyOffset.row),
      column: address.column + (address.absoluteColumn ? 0 : copyOffset.column),
    })
    const moved = { start: offset(range.start), end: offset(range.end) }
    // The address serializer validates both worksheet bounds and endpoint ordering.
    formatRangeAddress(moved)
    return moved
  }
  const { start, count, insert } = operation
  const axis = operation.axis ?? 'row'
  const first = range.start[axis]
  const last = range.end[axis]
  const end = start + count - 1
  let nextFirst = first
  let nextLast = last
  if (insert) {
    if (first >= start) nextFirst += count
    if (last >= start) nextLast += count
  } else {
    const removed = Math.max(0, Math.min(last, end) - Math.max(first, start) + 1)
    if (removed === last - first + 1) return undefined
    nextFirst = first > end ? first - count : first >= start ? start : first
    nextLast = nextFirst + last - first - removed
  }
  if (nextFirst < 1 || nextLast > (axis === 'row' ? MAX_ROWS : MAX_COLUMNS))
    throw new Error('References would exceed worksheet limits.')
  return { start: { ...range.start, [axis]: nextFirst }, end: { ...range.end, [axis]: nextLast } }
}

function referenceRange(node: FormulaAstNode): CellRange {
  if (node.type === 'reference') return { start: node.address, end: node.address }
  if (node.type === 'range') return node.range
  throw new Error('Expected an ordinary cell reference.')
}

function children(node: ASTNodeData): ASTNodeData[] {
  return [
    ...(node.args ?? []),
    ...[node.left, node.right, node.operand].filter((child): child is ASTNodeData => Boolean(child)),
  ]
}

/** Reference-only serialization: retain every other byte, then prove the whole resulting AST. */
export async function transformStructuralExpression(
  source: string,
  workbook: Workbook,
  formulaSheetId: string,
  operation: StructuralOperation,
  copyOffset?: CellAddress,
) {
  const { nativeAst, ast } = await parseStructuralFormula(source, workbook, formulaSheetId)
  const encoded = new TextEncoder().encode(source)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const replacements: Array<{ start: number; end: number; text: string }> = []
  const references: ASTNodeData[] = []
  const visit = (node: ASTNodeData) => {
    if (node.type === 'reference') references.push(node)
    children(node).forEach(visit)
  }
  visit(nativeAst)
  // Independently validate each token using the existing address codec. This rejects
  // 3D, open, reversed and ambiguous ranges even if the formula parser normalizes them.
  for (const node of references) {
    const start = node.sourceStart
    const end = node.sourceEnd
    if (start === undefined || end === undefined || start < 0 || end <= start || end > encoded.length)
      throw new Error('The formula parser did not provide a faithful reference span.')
    const token = decoder.decode(encoded.slice(start, end))
    const reference = node.reference!
    const qualified = reference.sheet
      ? parseSheetQualifiedAddress(token)
      : { range: parseRangeAddress(token), sheetName: undefined }
    const parsed = await parseStructuralFormula(`=${token}`, workbook, formulaSheetId)
    if (parsed.ast.type !== 'reference' && parsed.ast.type !== 'range') throw new Error('Unknown worksheet reference.')
    if (
      formatRangeAddress(qualified.range) !== formatRangeAddress(referenceRange(parsed.ast)) ||
      qualified.sheetName !== reference.sheet
    )
      throw new Error('Ambiguous formula reference. Keep the original cells.')
    const target = reference.sheet
      ? [...workbook.sheetsById.values()].find(
          (sheet) => sheet.name.toLocaleLowerCase('en-US') === reference.sheet!.toLocaleLowerCase('en-US'),
        )?.id
      : formulaSheetId
    if (!target) throw new Error('A formula references a missing worksheet.')
    if (!copyOffset && target !== operation.sheetId) continue
    const moved = moveRange(qualified.range, operation, copyOffset)
    const text = !moved
      ? '#REF!'
      : reference.sheet
        ? formatSheetQualifiedAddress(reference.sheet, moved)
        : formatRangeAddress(moved)
    replacements.push({ start, end, text })
  }
  let expression = ''
  let position = 0
  for (const replacement of replacements.sort((a, b) => a.start - b.start)) {
    if (replacement.start < position) throw new Error('Overlapping formula reference spans.')
    expression += decoder.decode(encoded.slice(position, replacement.start)) + replacement.text
    position = replacement.end
  }
  expression += decoder.decode(encoded.slice(position))
  const transform = (node: FormulaAstNode): FormulaAstNode => {
    if (node.type === 'reference' || node.type === 'range') {
      const target = node.sheetName
        ? [...workbook.sheetsById.values()].find(
            (sheet) => sheet.name.toLocaleLowerCase('en-US') === node.sheetName!.toLocaleLowerCase('en-US'),
          )?.id
        : formulaSheetId
      if (!copyOffset && target !== operation.sheetId) return node
      const range = moveRange(referenceRange(node), operation, copyOffset)
      if (!range) return { type: 'error', code: '#REF!' }
      // The existing parser canonicalizes a one-cell range to a reference.
      return range.start.row === range.end.row && range.start.column === range.end.column
        ? { type: 'reference', sheetName: node.sheetName, address: range.start }
        : { type: 'range', sheetName: node.sheetName, range }
    }
    if (node.type === 'binary') return { ...node, left: transform(node.left), right: transform(node.right) }
    if (node.type === 'unary') return { ...node, operand: transform(node.operand) }
    if (node.type === 'call') return { ...node, arguments: node.arguments.map(transform) }
    return node
  }
  const reparsed = await parseStructuralFormula(expression, workbook, formulaSheetId)
  if (JSON.stringify(reparsed.ast) !== JSON.stringify(transform(ast)))
    throw new Error('Formula serialization changed its meaning. Keep the original cells.')
  return { expression, ast: reparsed.ast }
}

/** Copy semantics offset only relative coordinates, including explicitly qualified references. */
export function transformCopyExpression(source: string, workbook: Workbook, sheetId: string, offset: CellAddress) {
  if (!Number.isInteger(offset.row) || !Number.isInteger(offset.column)) throw new Error('Invalid copy offset.')
  return transformStructuralExpression(source, workbook, sheetId, { sheetId, start: 1, count: 1, insert: true }, offset)
}

/** Workbook-wide preflight, including formulas outside the sheet being edited. No model mutation. */
export async function planStructuralFormulas(
  workbook: Workbook,
  operation: StructuralOperation,
): Promise<StructuralFormulaCells> {
  const result: StructuralFormulaCells = new Map()
  let count = 0
  if (workbook.formulaStructureUnsafe || workbook.definedNames.length)
    throw new Error('Undo earlier unsupported structural changes; defined-name rewriting is not supported.')
  // Literal-only workbooks need no parser or calculation engine initialization.
  if (
    ![...workbook.sheetsById.values()].some((sheet) =>
      [...sheet.cells.values()].some((cell) => cell.value.kind === 'formula'),
    )
  )
    return new Map([...workbook.sheetsById.values()].map((sheet) => [sheet.id, new Map(sheet.cells)]))
  const runtime = new FormulaRuntime()
  try {
    const calculation = await runtime.calculate(createFormulaWorkbookSnapshot(workbook, 0), true)
    if (
      calculation.warning ||
      calculation.updates.some(
        (update) => update.calculationStatus === 'unsupported' || update.calculationStatus === 'stale',
      )
    )
      throw new Error('Unsupported or spill formulas prevent safe structural editing. Keep the original cells.')
  } finally {
    runtime.reset()
  }
  for (const sheet of workbook.sheetsById.values()) {
    const cells = new Map(sheet.cells)
    for (const [address, cell] of sheet.cells) {
      if (cell.value.kind !== 'formula') continue
      if (++count > FORMULA_RESOURCE_LIMITS.formulaCells)
        throw new Error('Too many formulas for a safe structural operation.')
      const formula = cell.value.formula
      const source = formula.canonicalExpression || formula.source
      const { expression, ast } = await transformStructuralExpression(source, workbook, sheet.id, operation)
      cells.set(address, {
        ...cell,
        value: {
          kind: 'formula',
          formula: {
            ...formula,
            source: expression,
            canonicalExpression: expression,
            ast,
            cachedResult: { kind: 'blank' },
            calculationStatus: 'stale',
          },
        },
      })
    }
    result.set(sheet.id, cells)
  }
  return result
}

/** PP02 compatibility entry point; both axes use the same parser and serializer. */
export const transformRowExpression = transformStructuralExpression
