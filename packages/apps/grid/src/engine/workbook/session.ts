import { cellAddressKey, isAddressInRange, parseCellAddress, parseRangeAddress } from './address'
import { applyWorkbookPatch, planWorkbookAction, type WorkbookAction, type WorkbookCommand } from './commands'
import {
  cloneCell,
  getCell as readCell,
  getSparseRange,
  validateRange as validateCellRange,
  WorkbookInvariantError,
  type IdFactory,
} from './model'
import type {
  Cell,
  CellAddress,
  CellRange,
  CellStyle,
  CellValue,
  DefinedName,
  DirtyRegion,
  OOXMLPreservationState,
  SparseCellRange,
  Workbook,
  WorkbookChangeEvent,
  WorkbookHistoryState,
  WorkbookCalculationUpdate,
} from './types'

export class HistoryBudgetError extends Error {
  constructor(
    readonly estimatedBytes: number,
    readonly budgetBytes: number,
  ) {
    super(
      `This workbook operation needs ${estimatedBytes} bytes of history; the current limit is ${budgetBytes} bytes.`,
    )
    this.name = 'HistoryBudgetError'
  }
}

export interface WorkbookSessionOptions {
  historyBudgetBytes?: number
  idFactory?: IdFactory
}

export interface WorkbookSaveCheckpoint {
  readonly workbook: Workbook
  readonly token: number
}

const DEFAULT_HISTORY_BUDGET = 16 * 1024 * 1024

/** Mutable, in-memory workbook owner. Each operation is planned and validated before any patch is applied. */
export class WorkbookSession {
  private currentWorkbook: Workbook
  private readonly listeners = new Set<(event: WorkbookChangeEvent) => void>()
  private readonly undoStack: WorkbookCommand[] = []
  private readonly redoStack: WorkbookCommand[] = []
  private readonly idFactory: IdFactory
  private readonly historyBudgetBytes: number
  private historyBytes = 0
  private tokenCounter = 1
  private currentToken = 0
  private savedToken = 0
  private revision = 0
  private idCounter = 0
  private readonly issuedIds = new Set<string>()
  private lastDirtyRegions: DirtyRegion[] = []

  constructor(workbook: Workbook, options: WorkbookSessionOptions = {}) {
    this.currentWorkbook = workbook
    this.historyBudgetBytes = options.historyBudgetBytes ?? DEFAULT_HISTORY_BUDGET
    this.idFactory = options.idFactory ?? ((kind) => `${kind}-session-${++this.idCounter}`)
    if (!Number.isInteger(this.historyBudgetBytes) || this.historyBudgetBytes < 1) {
      throw new RangeError('History budget must be a positive integer.')
    }
  }

  get workbook(): Workbook {
    return this.currentWorkbook
  }

  get isDirty(): boolean {
    return this.currentToken !== this.savedToken
  }

  get historyState(): WorkbookHistoryState {
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoDepth: this.undoStack.length,
      redoDepth: this.redoStack.length,
      estimatedBytes: this.historyBytes,
    }
  }

  subscribe(listener: (event: WorkbookChangeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getLastDirtyRegions(): DirtyRegion[] {
    return structuredClone(this.lastDirtyRegions)
  }

  getCell(sheetId: string, address: CellAddress | string): Cell | undefined {
    const cell = readCell(this.requireSheet(sheetId), address)
    return cell ? cloneCell(cell) : undefined
  }

  /** Applies derived formula caches without creating user history or changing dirty state. */
  applyCalculationResults(updates: readonly WorkbookCalculationUpdate[]): void {
    const dirtyRegions: DirtyRegion[] = []
    const affectedSheetIds = new Set<string>()
    for (const update of updates) {
      const sheet = this.currentWorkbook.sheetsById.get(update.sheetId)
      const address = cellAddressKey(parseCellAddress(update.address))
      const cell = sheet?.cells.get(address)
      if (!sheet || !cell || cell.value.kind !== 'formula') continue

      const formula = cell.value.formula
      const nextFormula = {
        ...formula,
        ...(update.ast !== undefined ? { ast: update.ast } : {}),
        calculationStatus: update.calculationStatus,
        ...(update.result !== undefined ? { cachedResult: update.result } : {}),
      }
      if (JSON.stringify(formula) === JSON.stringify(nextFormula)) continue
      sheet.cells.set(address, { ...cell, value: { kind: 'formula', formula: nextFormula } })
      const parsed = parseCellAddress(address)
      dirtyRegions.push({ kind: 'cells', sheetId: sheet.id, range: { start: parsed, end: parsed } })
      affectedSheetIds.add(sheet.id)
    }
    if (dirtyRegions.length) {
      this.emit({
        kind: 'calculation',
        label: 'Recalculate formulas',
        dirtyRegions,
        affectedSheetIds: [...affectedSheetIds],
        impacts: [],
        dirtyChanged: false,
      })
    }
  }

  /** Changes the visible sheet without creating an edit or changing workbook dirty state. */
  activateSheet(sheetId: string): boolean {
    this.requireSheet(sheetId)
    if (this.currentWorkbook.activeSheetId === sheetId) return false
    this.currentWorkbook.activeSheetId = sheetId
    this.emit({
      kind: 'change',
      label: 'Activate sheet',
      dirtyRegions: [{ kind: 'sheet', sheetId }],
      affectedSheetIds: [sheetId],
      impacts: [],
      dirtyChanged: false,
    })
    return true
  }

  getRange(sheetId: string, range: CellRange | string): SparseCellRange {
    const parsed = typeof range === 'string' ? parseRangeAddress(range) : range
    this.validateRange(parsed)
    return {
      range: structuredClone(parsed),
      cells: new Map(
        [...getSparseRange(this.requireSheet(sheetId), parsed)].map(([address, cell]) => [address, cloneCell(cell)]),
      ),
    }
  }

  execute(action: WorkbookAction): boolean {
    const command = planWorkbookAction(this.currentWorkbook, action, {
      createId: (kind) => this.createId(kind),
    })
    if (command.patches.length === 0) return false
    if (command.estimatedBytes > this.historyBudgetBytes) {
      throw new HistoryBudgetError(command.estimatedBytes, this.historyBudgetBytes)
    }
    const wasDirty = this.isDirty
    command.beforeToken = this.currentToken
    command.afterToken = this.tokenCounter++
    for (const discarded of this.redoStack) this.historyBytes -= discarded.estimatedBytes
    this.redoStack.length = 0
    for (const patch of command.patches) applyWorkbookPatch(this.currentWorkbook, patch, 'forward')
    this.undoStack.push(command)
    this.historyBytes += command.estimatedBytes
    this.currentToken = command.afterToken
    while (this.historyBytes > this.historyBudgetBytes && this.undoStack.length > 1) {
      const evicted = this.undoStack.shift()!
      this.historyBytes -= evicted.estimatedBytes
    }
    this.emit({
      kind: 'change',
      label: command.label,
      dirtyRegions: command.dirtyRegions,
      affectedSheetIds: command.affectedSheetIds,
      impacts: command.impacts,
      dirtyChanged: wasDirty !== this.isDirty,
    })
    return true
  }

  setCell(sheetId: string, address: CellAddress | string, value: CellValue): boolean {
    return this.execute({ type: 'set-cells', sheetId, changes: [{ address, value }] })
  }

  setCells(sheetId: string, changes: Array<{ address: CellAddress | string; value: CellValue }>): boolean {
    return this.execute({ type: 'set-cells', sheetId, changes })
  }

  /** Replaces every value in a range from a sparse map; omitted addresses are cleared in the same undo step. */
  setRange(sheetId: string, range: CellRange | string, values: ReadonlyMap<string, CellValue>): boolean {
    const parsed = typeof range === 'string' ? parseRangeAddress(range) : range
    this.validateRange(parsed)
    const sheet = this.requireSheet(sheetId)
    const changes = new Map<string, CellValue>()
    for (const [rawAddress, value] of values) {
      const address = parseCellAddress(rawAddress)
      if (!isAddressInRange(address, parsed))
        throw new WorkbookInvariantError(`${rawAddress} is outside the target range.`)
      const key = cellAddressKey(address)
      if (changes.has(key)) throw new WorkbookInvariantError(`A cell appears more than once in one operation: ${key}`)
      changes.set(key, value)
    }
    for (const address of sheet.cells.keys()) {
      const parsedAddress = parseCellAddress(address)
      if (isAddressInRange(parsedAddress, parsed) && !changes.has(address)) changes.set(address, { kind: 'blank' })
    }
    return this.setCells(
      sheetId,
      [...changes].map(([address, value]) => ({ address, value })),
    )
  }

  formatCells(sheetId: string, changes: Array<{ address: CellAddress | string; style: CellStyle | null }>): boolean {
    return this.execute({ type: 'format-cells', sheetId, changes })
  }

  setRowMetadata(
    sheetId: string,
    row: number,
    metadata: { height?: number; hidden?: boolean; outlineLevel?: number; style?: CellStyle } | null,
  ): boolean {
    return this.execute({ type: 'set-row-metadata', sheetId, row, metadata })
  }

  setColumnMetadata(
    sheetId: string,
    column: number,
    metadata: { width?: number; hidden?: boolean; outlineLevel?: number; style?: CellStyle } | null,
  ): boolean {
    return this.execute({ type: 'set-column-metadata', sheetId, column, metadata })
  }

  insertRows(sheetId: string, start: number, count = 1): boolean {
    return this.execute({ type: 'insert-rows', sheetId, start, count })
  }

  deleteRows(sheetId: string, start: number, count = 1): boolean {
    return this.execute({ type: 'delete-rows', sheetId, start, count })
  }

  insertColumns(sheetId: string, start: number, count = 1): boolean {
    return this.execute({ type: 'insert-columns', sheetId, start, count })
  }

  deleteColumns(sheetId: string, start: number, count = 1): boolean {
    return this.execute({ type: 'delete-columns', sheetId, start, count })
  }

  merge(sheetId: string, range: CellRange | string): boolean {
    const parsed = typeof range === 'string' ? parseRangeAddress(range) : range
    this.validateRange(parsed)
    return this.execute({ type: 'merge', sheetId, range: parsed })
  }

  unmerge(sheetId: string, range: CellRange | string): boolean {
    const parsed = typeof range === 'string' ? parseRangeAddress(range) : range
    this.validateRange(parsed)
    return this.execute({ type: 'unmerge', sheetId, range: parsed })
  }

  createSheet(name: string, index?: number): string {
    const sheetId = this.createId('sheet')
    this.execute({ type: 'create-sheet', sheetId, name, index })
    return sheetId
  }

  renameSheet(sheetId: string, name: string): boolean {
    return this.execute({ type: 'rename-sheet', sheetId, name })
  }

  addDefinedName(name: DefinedName): boolean {
    return this.execute({ type: 'add-defined-name', name })
  }

  deleteDefinedName(name: string, scopeSheetId?: string): boolean {
    return this.execute({ type: 'delete-defined-name', name, scopeSheetId })
  }

  deleteSheet(sheetId: string): boolean {
    return this.execute({ type: 'delete-sheet', sheetId })
  }

  moveSheet(sheetId: string, index: number): boolean {
    return this.execute({ type: 'move-sheet', sheetId, index })
  }

  duplicateSheet(sheetId: string, name: string, index?: number): string {
    const duplicateId = this.createId('sheet')
    this.execute({ type: 'duplicate-sheet', sourceSheetId: sheetId, sheetId: duplicateId, name, index })
    return duplicateId
  }

  undo(): boolean {
    const command = this.undoStack.pop()
    if (!command) return false
    const wasDirty = this.isDirty
    for (const patch of [...command.patches].reverse()) applyWorkbookPatch(this.currentWorkbook, patch, 'backward')
    this.redoStack.push(command)
    this.currentToken = command.beforeToken
    this.emit({
      kind: 'change',
      label: `Undo ${command.label}`,
      dirtyRegions: command.dirtyRegions,
      affectedSheetIds: command.affectedSheetIds,
      impacts: command.impacts,
      dirtyChanged: wasDirty !== this.isDirty,
    })
    return true
  }

  redo(): boolean {
    const command = this.redoStack.pop()
    if (!command) return false
    const wasDirty = this.isDirty
    for (const patch of command.patches) applyWorkbookPatch(this.currentWorkbook, patch, 'forward')
    this.undoStack.push(command)
    this.currentToken = command.afterToken
    this.emit({
      kind: 'change',
      label: `Redo ${command.label}`,
      dirtyRegions: command.dirtyRegions,
      affectedSheetIds: command.affectedSheetIds,
      impacts: command.impacts,
      dirtyChanged: wasDirty !== this.isDirty,
    })
    return true
  }

  markClean(
    preservation?: Omit<OOXMLPreservationState, 'originalArchiveBytes'>,
    originalArchiveBytes?: Uint8Array,
  ): void {
    if (preservation && originalArchiveBytes) {
      this.currentWorkbook.preservation = {
        ...structuredClone(preservation),
        originalArchiveBytes: originalArchiveBytes.slice(),
      }
    }
    if (!this.isDirty) return
    this.savedToken = this.currentToken
    this.emit({ kind: 'dirty-state', dirtyRegions: [], affectedSheetIds: [], impacts: [], dirtyChanged: true })
  }

  createSaveCheckpoint(): WorkbookSaveCheckpoint {
    return { workbook: this.currentWorkbook, token: this.currentToken }
  }

  /** Records a successfully written snapshot; subsequent edits remain dirty and retain their original baseline. */
  markSaved(
    checkpoint: WorkbookSaveCheckpoint,
    preservation?: Omit<OOXMLPreservationState, 'originalArchiveBytes'>,
    originalArchiveBytes?: Uint8Array,
  ): boolean {
    if (checkpoint.workbook !== this.currentWorkbook) return false
    const wasDirty = this.isDirty
    this.savedToken = checkpoint.token
    if (this.currentToken === checkpoint.token && preservation && originalArchiveBytes) {
      this.currentWorkbook.preservation = {
        ...structuredClone(preservation),
        originalArchiveBytes: originalArchiveBytes.slice(),
      }
    }
    this.emit({
      kind: 'dirty-state',
      dirtyRegions: [],
      affectedSheetIds: [],
      impacts: [],
      dirtyChanged: wasDirty !== this.isDirty,
    })
    return !this.isDirty
  }

  /** New/Open adapters replace the in-memory model through this method; history and archive ownership reset together. */
  replaceWorkbook(workbook: Workbook): void {
    const wasDirty = this.isDirty
    this.currentWorkbook = workbook
    this.undoStack.length = 0
    this.redoStack.length = 0
    this.historyBytes = 0
    this.currentToken = this.tokenCounter++
    this.savedToken = this.currentToken
    this.emit({
      kind: 'replace',
      dirtyRegions: workbook.sheetOrder.map((sheetId) => ({ kind: 'sheet', sheetId })),
      affectedSheetIds: [...workbook.sheetOrder],
      impacts: ['all'],
      dirtyChanged: wasDirty,
    })
  }

  private requireSheet(sheetId: string) {
    const sheet = this.currentWorkbook.sheetsById.get(sheetId)
    if (!sheet) throw new WorkbookInvariantError(`Unknown worksheet: ${sheetId}`)
    return sheet
  }

  private createId(kind: 'sheet' | 'table'): string {
    const id = this.idFactory(kind)
    const duplicate =
      kind === 'sheet'
        ? this.currentWorkbook.sheetsById.has(id)
        : [...this.currentWorkbook.sheetsById.values()].some((sheet) => sheet.tables.some((table) => table.id === id))
    if (!id || duplicate || this.issuedIds.has(id)) {
      throw new WorkbookInvariantError(`The ${kind} id factory returned a duplicate or empty id.`)
    }
    this.issuedIds.add(id)
    return id
  }

  private validateRange(range: CellRange): void {
    validateCellRange(range)
  }

  private emit(
    event: Omit<WorkbookChangeEvent, 'revision' | 'isDirty'> & { revision?: number; isDirty?: boolean },
  ): void {
    this.revision += 1
    this.lastDirtyRegions = structuredClone(event.dirtyRegions)
    const complete: WorkbookChangeEvent = {
      ...event,
      revision: this.revision,
      isDirty: this.isDirty,
      dirtyRegions: structuredClone(event.dirtyRegions),
      affectedSheetIds: [...event.affectedSheetIds],
      impacts: [...event.impacts],
    }
    for (const listener of this.listeners) listener(complete)
  }
}
