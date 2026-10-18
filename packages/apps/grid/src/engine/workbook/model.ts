import { cellAddressKey, formatCellAddress, parseCellAddress, rangesOverlap } from './address'
import {
  MAX_COLUMNS,
  MAX_ROWS,
  type Cell,
  type CellAddress,
  type CellRange,
  type DateSystem,
  type DefinedName,
  type OOXMLPartPreservationDescriptor,
  type SheetDimensions,
  type Worksheet,
  type Workbook,
} from './types'

export class WorkbookInvariantError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkbookInvariantError'
  }
}

export type IdFactory = (kind: 'sheet' | 'table' | 'validation' | 'conditional-format') => string

let defaultId = 0
const defaultIdFactory: IdFactory = (kind) => `${kind}-${++defaultId}`

export function validateSheetName(name: string, existing: readonly string[] = []): void {
  if (
    !name.trim() ||
    [...name].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
    name.length > 31 ||
    /[:\\/?*]/.test(name) ||
    name.includes('[') ||
    name.includes(']') ||
    name.startsWith("'") ||
    name.endsWith("'")
  ) {
    throw new WorkbookInvariantError(
      'Sheet names must be 1–31 characters and cannot contain : \\ / ? * [ ] or edge apostrophes.',
    )
  }
  if (existing.some((candidate) => candidate.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US'))) {
    throw new WorkbookInvariantError(`A sheet named "${name}" already exists.`)
  }
}

export function validateDefinedName(name: string): void {
  if (name.length < 1 || name.length > 255 || !/^[A-Za-z_\\][A-Za-z0-9_.\\]*$/.test(name)) {
    throw new WorkbookInvariantError(`Invalid defined name: ${name}`)
  }
  if (/^[RC]$/i.test(name) || /^[A-Za-z]{1,3}\$?[1-9]\d*$/.test(name) || /^R\d+C\d+$/i.test(name)) {
    throw new WorkbookInvariantError(`Defined name cannot look like a cell address: ${name}`)
  }
}

export function createSheetDimensions(): SheetDimensions {
  return {
    rowLimit: MAX_ROWS,
    columnLimit: MAX_COLUMNS,
    defaultRowHeight: 15,
    defaultColumnWidth: 8.43,
    usedRange: null,
  }
}

export function createWorksheet(id: string, name: string): Worksheet {
  validateSheetName(name)
  return {
    id,
    name,
    cells: new Map(),
    dimensions: createSheetDimensions(),
    merges: [],
    rowMetadata: new Map(),
    columnMetadata: new Map(),
    tables: [],
    validations: [],
    conditionalFormats: [],
    drawings: [],
    pivots: [],
  }
}

export function createWorkbook(
  options: {
    name?: string
    firstSheetName?: string
    dateSystem?: DateSystem
    idFactory?: IdFactory
  } = {},
): Workbook {
  const id = (options.idFactory ?? defaultIdFactory)('sheet')
  const first = createWorksheet(id, options.firstSheetName ?? 'Sheet1')
  return {
    name: options.name ?? 'Book1',
    dateSystem: options.dateSystem ?? '1900',
    sheetsById: new Map([[id, first]]),
    sheetOrder: [id],
    activeSheetId: id,
    definedNames: [],
  }
}

export function createOpaquePartDescriptor(options: {
  partName: string
  contentType?: string
  relationshipIds?: string[]
  originalBytes?: Uint8Array
}): OOXMLPartPreservationDescriptor {
  const pathSegments = options.partName.split('/')
  if (
    !options.partName ||
    options.partName.startsWith('/') ||
    options.partName.includes('\\') ||
    pathSegments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new WorkbookInvariantError('OOXML part names must be relative package paths.')
  }
  return {
    partName: options.partName,
    ...(options.contentType ? { contentType: options.contentType } : {}),
    ...(options.relationshipIds ? { relationshipIds: [...options.relationshipIds] } : {}),
    dependsOn: ['all'],
    status: 'safe',
    unsafeReasons: [],
    ...(options.originalBytes ? { originalBytes: options.originalBytes.slice() } : {}),
  }
}

export function resolveSheet(workbook: Workbook, sheetIdOrName: string): Worksheet {
  const byId = workbook.sheetsById.get(sheetIdOrName)
  if (byId) return byId
  const byName = workbook.sheetOrder
    .map((id) => workbook.sheetsById.get(id))
    .find((sheet) => sheet?.name.toLocaleLowerCase('en-US') === sheetIdOrName.toLocaleLowerCase('en-US'))
  if (!byName) throw new WorkbookInvariantError(`Unknown worksheet: ${sheetIdOrName}`)
  return byName
}

export function getCell(sheet: Worksheet, address: CellAddress | string): Cell | undefined {
  const parsed = typeof address === 'string' ? parseCellAddress(address) : address
  return sheet.cells.get(cellAddressKey(parsed))
}

export function getSparseRange(sheet: Worksheet, range: CellRange): Map<string, Cell> {
  validateRange(range)
  const result = new Map<string, Cell>()
  for (const [key, cell] of sheet.cells) {
    const address = parseCellAddress(key)
    if (
      address.row >= range.start.row &&
      address.row <= range.end.row &&
      address.column >= range.start.column &&
      address.column <= range.end.column
    ) {
      result.set(key, cell)
    }
  }
  return result
}

export function getUsedRange(cells: ReadonlyMap<string, Cell>, merges: readonly CellRange[]): CellRange | null {
  let minRow = Number.POSITIVE_INFINITY
  let minColumn = Number.POSITIVE_INFINITY
  let maxRow = 0
  let maxColumn = 0
  const include = (address: CellAddress) => {
    minRow = Math.min(minRow, address.row)
    minColumn = Math.min(minColumn, address.column)
    maxRow = Math.max(maxRow, address.row)
    maxColumn = Math.max(maxColumn, address.column)
  }
  for (const key of cells.keys()) include(parseCellAddress(key))
  for (const merge of merges) {
    include(merge.start)
    include(merge.end)
  }
  if (maxRow === 0) return null
  return { start: { row: minRow, column: minColumn }, end: { row: maxRow, column: maxColumn } }
}

export function isUnallocatedBlank(cell: Cell): boolean {
  return cell.value.kind === 'blank' && cell.style === undefined
}

export function cloneWorksheet(source: Worksheet, id: string, name: string): Worksheet {
  return {
    ...source,
    id,
    name,
    ...(source.frozenPane ? { frozenPane: structuredClone(source.frozenPane) } : {}),
    ...(source.hyperlinks ? { hyperlinks: structuredClone(source.hyperlinks) } : {}),
    ...(source.autoFilter ? { autoFilter: structuredClone(source.autoFilter) } : {}),
    ...(source.printSettings ? { printSettings: structuredClone(source.printSettings) } : {}),
    ...(source.comments ? { comments: structuredClone(source.comments) } : {}),
    cells: new Map([...source.cells].map(([address, cell]) => [address, cloneCell(cell)])),
    dimensions: { ...source.dimensions, usedRange: cloneRange(source.dimensions.usedRange) },
    merges: source.merges.map((range) => cloneRange(range)!),
    rowMetadata: new Map([...source.rowMetadata].map(([index, value]) => [index, structuredClone(value)])),
    columnMetadata: new Map([...source.columnMetadata].map(([index, value]) => [index, structuredClone(value)])),
    tables: source.tables.map((table) => structuredClone(table)),
    validations: source.validations.map((validation) => structuredClone(validation)),
    conditionalFormats: source.conditionalFormats.map((rule) => structuredClone(rule)),
    drawings: source.drawings.map((drawing, index) => ({
      ...structuredClone(drawing),
      id: `${drawing.id}-copy-${index + 1}`,
      preservationStatus: 'unsafe',
    })),
    pivots: source.pivots.map((pivot, index) => ({
      ...structuredClone(pivot),
      id: `${pivot.id}-copy-${index + 1}`,
      name: `${pivot.name}_copy`,
      preservationStatus: 'unsafe',
      refreshRequired: true,
    })),
  }
}

export function cloneCell(cell: Cell): Cell {
  return structuredClone(cell)
}

export function cloneRange(range: CellRange | null | undefined): CellRange | null {
  if (!range) return null
  return {
    start: { ...range.start },
    end: { ...range.end },
  }
}

export function validateRange(range: CellRange): void {
  for (const address of [range.start, range.end]) {
    if (!Number.isInteger(address.row) || address.row < 1 || address.row > MAX_ROWS) {
      throw new WorkbookInvariantError(`Row must be between 1 and ${MAX_ROWS}.`)
    }
    if (!Number.isInteger(address.column) || address.column < 1 || address.column > MAX_COLUMNS) {
      throw new WorkbookInvariantError(`Column must be between 1 and ${MAX_COLUMNS}.`)
    }
  }
  if (range.start.row > range.end.row || range.start.column > range.end.column) {
    throw new WorkbookInvariantError('Range start must be above and to the left of its end.')
  }
}

export function assertNoMergeOverlap(sheet: Worksheet, candidate: CellRange, ignoring?: CellRange): void {
  if (
    rangesOverlap(candidate, candidate) &&
    candidate.start.row === candidate.end.row &&
    candidate.start.column === candidate.end.column
  ) {
    throw new WorkbookInvariantError('A merged range must contain more than one cell.')
  }
  if (sheet.merges.some((merge) => merge !== ignoring && rangesOverlap(candidate, merge))) {
    throw new WorkbookInvariantError('Merged ranges cannot overlap.')
  }
}

export function addDefinedName(workbook: Workbook, name: DefinedName): DefinedName[] {
  validateDefinedName(name.name)
  const duplicate = workbook.definedNames.some(
    (candidate) =>
      candidate.name.toLocaleLowerCase('en-US') === name.name.toLocaleLowerCase('en-US') &&
      candidate.scopeSheetId === name.scopeSheetId,
  )
  if (duplicate) throw new WorkbookInvariantError(`Defined name already exists: ${name.name}`)
  if (name.scopeSheetId && !workbook.sheetsById.has(name.scopeSheetId)) {
    throw new WorkbookInvariantError(`Unknown worksheet scope for defined name: ${name.name}`)
  }
  if (name.targetSheetId && !workbook.sheetsById.has(name.targetSheetId)) {
    throw new WorkbookInvariantError(`Unknown worksheet target for defined name: ${name.name}`)
  }
  if (name.range) validateRange(name.range)
  return [...workbook.definedNames, structuredClone(name)]
}

/** A worksheet-local name shadows a workbook-wide name, independent of its range target. */
export function resolveDefinedName(workbook: Workbook, name: string, scopeSheetId?: string): DefinedName | undefined {
  if (scopeSheetId && !workbook.sheetsById.has(scopeSheetId)) {
    throw new WorkbookInvariantError(`Unknown worksheet scope: ${scopeSheetId}`)
  }
  const key = name.toLocaleLowerCase('en-US')
  const matches = workbook.definedNames.filter((candidate) => candidate.name.toLocaleLowerCase('en-US') === key)
  const found =
    (scopeSheetId ? matches.find((candidate) => candidate.scopeSheetId === scopeSheetId) : undefined) ??
    matches.find((candidate) => candidate.scopeSheetId === undefined)
  return found ? structuredClone(found) : undefined
}

export function formatA1(address: CellAddress): string {
  return formatCellAddress(address)
}
