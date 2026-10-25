import { planColumnChart, ChartError, validateChartAnchor } from './chart'
import type { SimpleColumnChart } from './types'
import { cellAddressKey, compareCellAddresses, isAddressInRange, parseCellAddress } from './address'
import { sortedRangeCells, type SortOptions } from './sort'
import { filteredRows } from './filter'
import { planSimpleTable, validateTableContext } from './table'
import { evaluateFilterRows } from './filter'
import { createFrozenPane, supportedFrozenPane } from './freeze'
import type { FilterCriterion } from './types'
import {
  assertNoMergeOverlap,
  addDefinedName,
  cloneRange,
  cloneWorksheet,
  createWorksheet,
  getUsedRange,
  isUnallocatedBlank,
  validateRange,
  validateSheetName,
} from './model'
import {
  MAX_COLUMNS,
  MAX_ROWS,
  type Cell,
  type CellAddress,
  type CellRange,
  type CellStyle,
  type CellValue,
  type ColumnMetadata,
  type DirtyRegion,
  type DefinedName,
  type FormulaAstNode,
  type PreservationImpact,
  type RowMetadata,
  type Worksheet,
  type Workbook,
} from './types'

export type WorkbookAction =
  | { type: 'place-chart'; sheetId: string; chartId: string; range: CellRange }
  | { type: 'set-chart'; sheetId: string; chart: SimpleColumnChart }
  | { type: 'remove-chart'; sheetId: string; chartId: string }
  | { type: 'create-table'; sheetId: string; range: CellRange; name: string }
  | { type: 'convert-table'; sheetId: string; tableId: string }
  | { type: 'set-frozen-panes'; sheetId: string; rows: boolean; columns: boolean }
  | { type: 'set-auto-filter'; sheetId: string; range: CellRange; criteria: FilterCriterion[] }
  | ({ type: 'sort-range'; sheetId: string } & SortOptions)
  | { type: 'add-defined-name'; name: DefinedName }
  | { type: 'delete-defined-name'; name: string; scopeSheetId?: string }
  | { type: 'set-cells'; sheetId: string; changes: Array<{ address: CellAddress | string; value: CellValue }> }
  | {
      type: 'format-cells'
      sheetId: string
      changes: Array<{ address: CellAddress | string; style: CellStyle | null }>
    }
  | { type: 'set-row-metadata'; sheetId: string; row: number; metadata: RowMetadata | null }
  | { type: 'set-column-metadata'; sheetId: string; column: number; metadata: ColumnMetadata | null }
  | { type: 'insert-rows' | 'delete-rows'; sheetId: string; start: number; count: number }
  | { type: 'insert-columns' | 'delete-columns'; sheetId: string; start: number; count: number }
  | { type: 'merge'; sheetId: string; range: CellRange }
  | { type: 'unmerge'; sheetId: string; range: CellRange }
  | { type: 'create-sheet'; sheetId: string; name: string; index?: number }
  | { type: 'rename-sheet'; sheetId: string; name: string }
  | { type: 'delete-sheet'; sheetId: string }
  | { type: 'move-sheet'; sheetId: string; index: number }
  | { type: 'duplicate-sheet'; sourceSheetId: string; sheetId: string; name: string; index?: number }

export interface CellPatchChange {
  address: string
  before?: Cell
  after?: Cell
}

export type WorkbookPatch =
  | { kind: 'cells'; sheetId: string; changes: CellPatchChange[] }
  | { kind: 'worksheet-field'; sheetId: string; field: string; before: unknown; after: unknown }
  | { kind: 'sheet-record'; sheetId: string; before?: Worksheet; after?: Worksheet }
  | { kind: 'sheet-order'; before: string[]; after: string[] }
  | {
      kind: 'workbook-field'
      field: 'activeSheetId' | 'definedNames' | 'preservation' | 'formulaStructureUnsafe'
      before: unknown
      after: unknown
    }

export interface WorkbookCommand {
  label: string
  patches: WorkbookPatch[]
  dirtyRegions: DirtyRegion[]
  affectedSheetIds: string[]
  impacts: PreservationImpact[]
  estimatedBytes: number
  beforeToken: number
  afterToken: number
}

export interface CommandPlannerOptions {
  createId: (kind: 'sheet' | 'table') => string
  /** Supplied only by asynchronous structural preflight; coordinates here are still original. */
  structuralFormulaCells?: Map<string, Map<string, Cell>>
}

export function planWorkbookAction(
  workbook: Workbook,
  action: WorkbookAction,
  options: CommandPlannerOptions,
): WorkbookCommand {
  const patches: WorkbookPatch[] = []
  const dirtyRegions: DirtyRegion[] = []
  const affected = new Set<string>()
  const impacts = new Set<PreservationImpact>()
  const includeImpacts = (...values: PreservationImpact[]) => values.forEach((impact) => impacts.add(impact))
  const addPatch = (patch: WorkbookPatch) => patches.push(patch)

  if (
    [
      'insert-rows',
      'delete-rows',
      'insert-columns',
      'delete-columns',
      'rename-sheet',
      'delete-sheet',
      'duplicate-sheet',
    ].includes(action.type) &&
    [...workbook.sheetsById.values()].some((sheet) => sheet.drawings.some((drawing) => drawing.chart))
  )
    throw new ChartError('context')
  switch (action.type) {
    case 'place-chart': {
      const sheet = requireSheet(workbook, action.sheetId)
      const drawing = sheet.drawings.find((item) => item.id === action.chartId && item.chart)
      if (!drawing || sheet.drawings.length !== 1) throw new ChartError('context')
      validateChartAnchor(action.range)
      const after = [{ ...structuredClone(drawing), range: cloneRange(action.range) }]
      if (!sameValue(sheet.drawings, after)) {
        addPatch({ kind: 'worksheet-field', sheetId: sheet.id, field: 'drawings', before: sheet.drawings, after })
        dirtyRegions.push({ kind: 'sheet', sheetId: sheet.id })
        affected.add(sheet.id)
      }
      break
    }
    case 'set-chart':
    case 'remove-chart': {
      const sheet = requireSheet(workbook, action.sheetId)
      const existing = sheet.drawings.find((drawing) => drawing.chart)
      if (action.type === 'remove-chart' && (!existing || existing.id !== action.chartId))
        throw new ChartError('context')
      const after = action.type === 'set-chart' ? [planColumnChart(workbook, sheet, action.chart, existing)] : []
      if (!sameValue(sheet.drawings, after)) {
        addPatch({ kind: 'worksheet-field', sheetId: sheet.id, field: 'drawings', before: sheet.drawings, after })
        dirtyRegions.push({ kind: 'sheet', sheetId: sheet.id })
        affected.add(sheet.id)
      }
      break
    }
    case 'create-table':
    case 'convert-table': {
      const sheet = requireSheet(workbook, action.sheetId)
      validateTableContext(workbook, sheet)
      let tables: Worksheet['tables']
      let autoFilter: Worksheet['autoFilter']
      let rows = sheet.rowMetadata
      if (action.type === 'create-table') {
        const table = planSimpleTable(workbook, sheet, action.range, action.name)
        tables = [table]
        autoFilter = { range: structuredClone(table.range), criteria: [] }
      } else {
        const table = sheet.tables.find((t) => t.id === action.tableId)
        if (!table || table.ownership !== 'simple') throw new Error('Unsupported imported table.')
        tables = []
        autoFilter = undefined
        rows = evaluateFilterRows(sheet, table.range, [])
      }
      for (const [field, before, after] of [
        ['tables', sheet.tables, tables],
        ['autoFilter', sheet.autoFilter, autoFilter],
        ['rowMetadata', sheet.rowMetadata, rows],
      ] as const) {
        if (field === 'rowMetadata' ? !sameMap(sheet.rowMetadata, rows) : !sameValue(before, after))
          addPatch({ kind: 'worksheet-field', sheetId: sheet.id, field, before, after })
      }
      dirtyRegions.push({ kind: 'sheet', sheetId: sheet.id })
      affected.add(sheet.id)
      includeImpacts('row-visibility')
      break
    }
    case 'set-frozen-panes': {
      const sheet = requireSheet(workbook, action.sheetId)
      if (sheet.unsupportedSheetViews || !supportedFrozenPane(sheet.frozenPane))
        throw new Error('Unsupported imported worksheet views must be preserved.')
      if (typeof action.rows !== 'boolean' || typeof action.columns !== 'boolean')
        throw new Error('Invalid frozen pane state.')
      const after = createFrozenPane(action.rows, action.columns)
      if (!sameValue(sheet.frozenPane, after)) {
        addPatch({ kind: 'worksheet-field', sheetId: sheet.id, field: 'frozenPane', before: sheet.frozenPane, after })
        dirtyRegions.push({ kind: 'sheet', sheetId: sheet.id })
        affected.add(sheet.id)
        includeImpacts('sheet-views')
      }
      break
    }
    case 'set-auto-filter': {
      const sheet = requireSheet(workbook, action.sheetId)
      const rows = filteredRows(workbook, sheet, action.range, action.criteria)
      const autoFilter = {
        ...sheet.autoFilter,
        range: structuredClone(action.range),
        criteria: structuredClone(action.criteria),
      }
      if (!sameValue(sheet.autoFilter, autoFilter)) {
        addPatch({
          kind: 'worksheet-field',
          sheetId: sheet.id,
          field: 'autoFilter',
          before: sheet.autoFilter,
          after: autoFilter,
        })
      }
      if (!sameMap(sheet.rowMetadata, rows)) {
        addPatch({
          kind: 'worksheet-field',
          sheetId: sheet.id,
          field: 'rowMetadata',
          before: sheet.rowMetadata,
          after: rows,
        })
      }
      dirtyRegions.push({ kind: 'sheet', sheetId: sheet.id })
      affected.add(sheet.id)
      includeImpacts('row-visibility')
      break
    }
    case 'sort-range': {
      const sheet = requireSheet(workbook, action.sheetId)
      const changes = diffCellMaps(sheet.cells, sortedRangeCells(workbook, sheet, action))
      addCellPatch(addPatch, sheet.id, changes)
      if (changes.length) {
        addUsedRangePatch(addPatch, sheet, new Map(changes.map((change) => [change.address, change])))
        dirtyRegions.push({ kind: 'cells', sheetId: sheet.id, range: structuredClone(action.range) })
        affected.add(sheet.id)
        includeImpacts('cell-values', 'cell-styles', 'cell-addresses')
      }
      break
    }
    case 'add-defined-name': {
      const after = addDefinedName(workbook, action.name)
      addPatch({ kind: 'workbook-field', field: 'definedNames', before: workbook.definedNames, after })
      includeImpacts('sheet-structure')
      markWorkbookFormulaCellsStale(workbook, addPatch, dirtyRegions, affected)
      break
    }
    case 'delete-defined-name': {
      if (action.scopeSheetId) requireSheet(workbook, action.scopeSheetId)
      const after = workbook.definedNames.filter(
        (name) =>
          name.scopeSheetId !== action.scopeSheetId ||
          name.name.toLocaleLowerCase('en-US') !== action.name.toLocaleLowerCase('en-US'),
      )
      if (after.length === workbook.definedNames.length) break
      addPatch({ kind: 'workbook-field', field: 'definedNames', before: workbook.definedNames, after })
      includeImpacts('sheet-structure')
      markWorkbookFormulaCellsStale(workbook, addPatch, dirtyRegions, affected)
      break
    }
    case 'set-cells': {
      const sheet = requireSheet(workbook, action.sheetId)
      const nextCells = new Map(sheet.cells)
      const seen = new Set<string>()
      for (const change of action.changes) {
        const address = canonicalAddress(change.address)
        if (
          sheet.tables.some(
            (t) =>
              t.ownership === 'simple' &&
              address.row === t.range.start.row &&
              address.column >= t.range.start.column &&
              address.column <= t.range.end.column,
          )
        )
          throw new Error('Table headers are read-only. Convert to range first.')
        const key = cellAddressKey(address)
        if (seen.has(key)) {
          throw new Error(`A cell appears more than once in one operation: ${key}`)
        }
        seen.add(key)
        const next: Cell | undefined = makeCell(nextCells.get(key), change.value)
        if (next) nextCells.set(key, next)
        else nextCells.delete(key)
      }
      const updatedCells = nextCells
      if (
        sheet.autoFilter?.criteria &&
        action.changes.some((change) => isAddressInRange(canonicalAddress(change.address), sheet.autoFilter!.range))
      ) {
        const rows = filteredRows(
          workbook,
          { ...sheet, cells: updatedCells },
          sheet.autoFilter.range,
          sheet.autoFilter.criteria,
        )
        if (!sameMap(sheet.rowMetadata, rows))
          addPatch({
            kind: 'worksheet-field',
            sheetId: sheet.id,
            field: 'rowMetadata',
            before: sheet.rowMetadata,
            after: rows,
          })
      }
      const changes = diffCellMaps(sheet.cells, updatedCells)
      addCellPatch(addPatch, sheet.id, changes)
      if (changes.length) {
        dirtyRegions.push(
          ...cellDirtyRegions(
            sheet.id,
            changes.map((change) => change.address),
          ),
        )
        affected.add(sheet.id)
        includeImpacts('cell-values')
        addUsedRangePatch(addPatch, sheet, new Map(changes.map((change) => [change.address, change])))
        markFormulaDependentsStale(
          workbook,
          sheet.id,
          changes.map((change) => change.address),
          updatedCells,
          addPatch,
          dirtyRegions,
          affected,
        )
      }
      break
    }
    case 'format-cells': {
      const sheet = requireSheet(workbook, action.sheetId)
      const changes = new Map<string, CellPatchChange>()
      const seen = new Set<string>()
      for (const change of action.changes) {
        const address = canonicalAddress(change.address)
        const key = cellAddressKey(address)
        if (seen.has(key)) throw new Error(`A cell appears more than once in one operation: ${key}`)
        seen.add(key)
        const before = sheet.cells.get(key)
        const after = makeFormattedCell(before, change.style)
        if (equalCell(before, after)) continue
        changes.set(key, { address: key, before, after })
      }
      addCellPatch(addPatch, sheet.id, [...changes.values()])
      if (changes.size) {
        dirtyRegions.push(...cellDirtyRegions(sheet.id, [...changes.keys()]))
        affected.add(sheet.id)
        includeImpacts('cell-styles')
        addUsedRangePatch(addPatch, sheet, changes)
      }
      break
    }
    case 'set-row-metadata':
    case 'set-column-metadata': {
      const sheet = requireSheet(workbook, action.sheetId)
      const isRow = action.type === 'set-row-metadata'
      const index = isRow ? action.row : action.column
      const limit = isRow ? MAX_ROWS : MAX_COLUMNS
      assertAxis(index, 1, limit, isRow ? 'row' : 'column')
      const field = isRow ? 'rowMetadata' : 'columnMetadata'
      const current = isRow ? sheet.rowMetadata : sheet.columnMetadata
      const next = new Map(current)
      if (action.metadata === null) next.delete(index)
      else next.set(index, structuredClone(action.metadata))
      if (isRow) {
        if (sheet.autoFilter && index === sheet.autoFilter.range.start.row && action.metadata?.hidden)
          throw new Error('Filter headers must remain visible.')
        if (sheet.rowMetadata.get(index)?.filterHidden) next.set(index, { ...next.get(index), filterHidden: true })
      }
      if (!sameMap(current, next)) {
        addPatch({ kind: 'worksheet-field', sheetId: sheet.id, field, before: current, after: next })
        dirtyRegions.push(
          isRow
            ? { kind: 'rows', sheetId: sheet.id, startRow: index, endRow: index }
            : { kind: 'columns', sheetId: sheet.id, startColumn: index, endColumn: index },
        )
        affected.add(sheet.id)
        includeImpacts('cell-styles')
      }
      break
    }
    case 'insert-rows':
    case 'delete-rows':
    case 'insert-columns':
    case 'delete-columns': {
      const sheet = requireSheet(workbook, action.sheetId)
      const axis = action.type.endsWith('rows') ? 'row' : 'column'
      if (sheet.autoFilter?.criteria) throw new Error('Structural changes to a filtered sheet are not supported.')
      const insert = action.type.startsWith('insert')
      const limit = axis === 'row' ? MAX_ROWS : MAX_COLUMNS
      assertAxis(action.start, 1, limit, axis)
      if (!Number.isInteger(action.count) || action.count < 1 || action.count > limit) {
        throw new Error(`Count must be an integer between 1 and ${limit}.`)
      }
      if (action.start + action.count - 1 > limit) throw new Error('The operation exceeds worksheet limits.')
      if (
        !options.structuralFormulaCells &&
        !workbook.formulaStructureUnsafe &&
        ([...workbook.sheetsById.values()].some((item) =>
          [...item.cells.values()].some((cell) => cell.value.kind === 'formula'),
        ) ||
          workbook.definedNames.some((name) => Boolean(name.formula)))
      ) {
        addPatch({
          kind: 'workbook-field',
          field: 'formulaStructureUnsafe',
          before: workbook.formulaStructureUnsafe,
          after: true,
        })
      }
      const nextCells = transformCellMap(
        options.structuralFormulaCells?.get(sheet.id) ?? sheet.cells,
        axis,
        action.start,
        action.count,
        insert,
      )
      const newCells = markFormulasStale(nextCells)
      addCellPatch(addPatch, sheet.id, diffCellMaps(sheet.cells, newCells))

      const propertyValues = transformWorksheetProperties(sheet, axis, action.start, action.count, insert, newCells)
      for (const [field, after] of propertyValues) {
        const before = getWorksheetField(sheet, field)
        if (!sameValue(before, after)) addPatch({ kind: 'worksheet-field', sheetId: sheet.id, field, before, after })
      }
      if (insert) {
        includeImpacts('cell-addresses', 'sheet-structure')
        dirtyRegions.push(
          axis === 'row'
            ? { kind: 'rows', sheetId: sheet.id, startRow: action.start, endRow: limit }
            : { kind: 'columns', sheetId: sheet.id, startColumn: action.start, endColumn: limit },
        )
      } else {
        includeImpacts('cell-addresses', 'sheet-structure', 'cell-values')
        dirtyRegions.push({ kind: 'sheet', sheetId: sheet.id })
      }
      affected.add(sheet.id)
      if (options.structuralFormulaCells) {
        for (const other of workbook.sheetsById.values()) {
          if (other.id === sheet.id) continue
          const changes = diffCellMaps(other.cells, options.structuralFormulaCells.get(other.id)!)
          addCellPatch(addPatch, other.id, changes)
          if (changes.length) {
            dirtyRegions.push({ kind: 'sheet', sheetId: other.id })
            affected.add(other.id)
          }
        }
      } else markOtherFormulaCellsStale(workbook, sheet.id, addPatch, dirtyRegions, affected)
      const nextNames = transformDefinedNames(workbook, sheet.id, axis, action.start, action.count, insert)
      if (!sameValue(workbook.definedNames, nextNames))
        addPatch({ kind: 'workbook-field', field: 'definedNames', before: workbook.definedNames, after: nextNames })
      break
    }
    case 'merge': {
      const sheet = requireSheet(workbook, action.sheetId)
      validateRange(action.range)
      assertNoMergeOverlap(sheet, action.range)
      const after = [...sheet.merges, cloneRange(action.range)!]
      addPatch({ kind: 'worksheet-field', sheetId: sheet.id, field: 'merges', before: sheet.merges, after })
      const dimensions = { ...sheet.dimensions, usedRange: getUsedRange(sheet.cells, after) }
      addPatch({
        kind: 'worksheet-field',
        sheetId: sheet.id,
        field: 'dimensions',
        before: sheet.dimensions,
        after: dimensions,
      })
      dirtyRegions.push({ kind: 'cells', sheetId: sheet.id, range: action.range })
      affected.add(sheet.id)
      includeImpacts('sheet-structure')
      break
    }
    case 'unmerge': {
      const sheet = requireSheet(workbook, action.sheetId)
      validateRange(action.range)
      const key = rangeKey(action.range)
      const after = sheet.merges.filter((range) => rangeKey(range) !== key)
      if (after.length === sheet.merges.length) break
      addPatch({ kind: 'worksheet-field', sheetId: sheet.id, field: 'merges', before: sheet.merges, after })
      addPatch({
        kind: 'worksheet-field',
        sheetId: sheet.id,
        field: 'dimensions',
        before: sheet.dimensions,
        after: { ...sheet.dimensions, usedRange: getUsedRange(sheet.cells, after) },
      })
      dirtyRegions.push({ kind: 'cells', sheetId: sheet.id, range: action.range })
      affected.add(sheet.id)
      includeImpacts('sheet-structure')
      break
    }
    case 'create-sheet': {
      validateSheetName(action.name, sheetNames(workbook))
      if (workbook.sheetsById.has(action.sheetId)) throw new Error(`Duplicate worksheet id: ${action.sheetId}`)
      const index = insertionIndex(action.index, workbook.sheetOrder.length, workbook.sheetOrder.length)
      const sheet = createWorksheet(action.sheetId, action.name)
      const order = workbook.sheetOrder.slice()
      order.splice(index, 0, sheet.id)
      addPatch({ kind: 'sheet-record', sheetId: sheet.id, after: sheet })
      addPatch({ kind: 'sheet-order', before: workbook.sheetOrder, after: order })
      addPatch({ kind: 'workbook-field', field: 'activeSheetId', before: workbook.activeSheetId, after: sheet.id })
      dirtyRegions.push({ kind: 'sheet', sheetId: sheet.id })
      affected.add(sheet.id)
      includeImpacts('sheet-structure', 'sheet-order')
      break
    }
    case 'rename-sheet': {
      const sheet = requireSheet(workbook, action.sheetId)
      validateSheetName(action.name, sheetNames(workbook, sheet.id))
      if (sheet.name === action.name) break
      const renamed = { ...sheet, name: action.name }
      addPatch({ kind: 'sheet-record', sheetId: sheet.id, before: sheet, after: renamed })
      markWorkbookFormulaCellsStale(workbook, addPatch, dirtyRegions, affected)
      const names = workbook.definedNames.map((name) => ({ ...name, stale: true }))
      if (!sameValue(workbook.definedNames, names))
        addPatch({ kind: 'workbook-field', field: 'definedNames', before: workbook.definedNames, after: names })
      dirtyRegions.push({ kind: 'sheet', sheetId: sheet.id })
      affected.add(sheet.id)
      includeImpacts('sheet-names', 'sheet-structure')
      break
    }
    case 'delete-sheet': {
      const sheet = requireSheet(workbook, action.sheetId)
      if (workbook.sheetOrder.length <= 1) throw new Error('A workbook must contain at least one worksheet.')
      const order = workbook.sheetOrder.filter((id) => id !== sheet.id)
      addPatch({ kind: 'sheet-record', sheetId: sheet.id, before: sheet })
      addPatch({ kind: 'sheet-order', before: workbook.sheetOrder, after: order })
      if (workbook.activeSheetId === sheet.id) {
        const replacement = order[Math.min(workbook.sheetOrder.indexOf(sheet.id), order.length - 1)]
        addPatch({ kind: 'workbook-field', field: 'activeSheetId', before: sheet.id, after: replacement })
      }
      const names = workbook.definedNames
        .filter((name) => name.scopeSheetId !== sheet.id)
        .map((name) => ({
          ...name,
          stale: true,
          ...(name.targetSheetId === sheet.id ? { rangeStatus: 'unsafe' as const } : {}),
        }))
      if (!sameValue(workbook.definedNames, names))
        addPatch({ kind: 'workbook-field', field: 'definedNames', before: workbook.definedNames, after: names })
      markOtherFormulaCellsStale(workbook, sheet.id, addPatch, dirtyRegions, affected)
      dirtyRegions.push({ kind: 'sheet', sheetId: sheet.id })
      affected.add(sheet.id)
      includeImpacts('sheet-structure', 'sheet-order', 'sheet-names')
      break
    }
    case 'move-sheet': {
      const sheet = requireSheet(workbook, action.sheetId)
      if (!Number.isInteger(action.index) || action.index < 0 || action.index >= workbook.sheetOrder.length) {
        throw new Error('Sheet index is outside the workbook.')
      }
      const currentIndex = workbook.sheetOrder.indexOf(sheet.id)
      if (currentIndex === action.index) break
      const order = workbook.sheetOrder.slice()
      order.splice(currentIndex, 1)
      order.splice(action.index, 0, sheet.id)
      addPatch({ kind: 'sheet-order', before: workbook.sheetOrder, after: order })
      dirtyRegions.push({ kind: 'sheet', sheetId: sheet.id })
      affected.add(sheet.id)
      includeImpacts('sheet-order', 'sheet-structure')
      break
    }
    case 'duplicate-sheet': {
      const source = requireSheet(workbook, action.sourceSheetId)
      validateSheetName(action.name, sheetNames(workbook))
      if (workbook.sheetsById.has(action.sheetId)) throw new Error(`Duplicate worksheet id: ${action.sheetId}`)
      const index = insertionIndex(action.index, workbook.sheetOrder.indexOf(source.id) + 1, workbook.sheetOrder.length)
      const duplicate = cloneWorksheet(source, action.sheetId, action.name)
      duplicate.tables = duplicate.tables.map((table, tableIndex) => ({
        ...table,
        id: options.createId('table'),
        name: uniqueTableName(workbook, table.name, tableIndex + 1),
      }))
      addPatch({ kind: 'sheet-record', sheetId: duplicate.id, after: duplicate })
      const order = workbook.sheetOrder.slice()
      order.splice(index, 0, duplicate.id)
      addPatch({ kind: 'sheet-order', before: workbook.sheetOrder, after: order })
      addPatch({ kind: 'workbook-field', field: 'activeSheetId', before: workbook.activeSheetId, after: duplicate.id })
      const copiedNames = workbook.definedNames
        .filter((name) => name.scopeSheetId === source.id)
        .map((name) => ({
          ...structuredClone(name),
          scopeSheetId: duplicate.id,
          ...(name.targetSheetId === source.id ? { targetSheetId: duplicate.id } : {}),
          stale: Boolean(name.formula) || name.stale === true,
        }))
      if (copiedNames.length)
        addPatch({
          kind: 'workbook-field',
          field: 'definedNames',
          before: workbook.definedNames,
          after: [...workbook.definedNames, ...copiedNames],
        })
      markWorksheetFormulaCellsStale(duplicate, addPatch, dirtyRegions, affected)
      dirtyRegions.push({ kind: 'sheet', sheetId: duplicate.id })
      affected.add(duplicate.id)
      includeImpacts('sheet-structure', 'sheet-order', 'sheet-names', 'cell-addresses')
      break
    }
  }

  // An operation below the sparse used range can still move opaque note/VML anchors.
  if (impacts.size && (patches.length || impacts.has('cell-addresses')))
    addPreservationInvalidation(workbook, [...impacts], action.type, patches)
  const uniqueAffected = [...affected]
  return {
    label: labelFor(action),
    patches,
    dirtyRegions: deduplicateDirtyRegions(dirtyRegions),
    affectedSheetIds: uniqueAffected,
    impacts: [...impacts],
    estimatedBytes: estimatePatchBytes(patches),
    beforeToken: 0,
    afterToken: 0,
  }
}

function requireSheet(workbook: Workbook, sheetId: string): Worksheet {
  const sheet = workbook.sheetsById.get(sheetId)
  if (!sheet) throw new Error(`Unknown worksheet: ${sheetId}`)
  return sheet
}

function canonicalAddress(address: CellAddress | string): CellAddress {
  const parsed = typeof address === 'string' ? parseCellAddress(address) : address
  parseCellAddress(
    `${parsed.absoluteColumn ? '$' : ''}${columnLetters(parsed.column)}${parsed.absoluteRow ? '$' : ''}${parsed.row}`,
  )
  return parsed
}

function columnLetters(column: number): string {
  let result = ''
  let value = column
  if (!Number.isInteger(value) || value < 1 || value > MAX_COLUMNS) throw new Error(`Invalid column: ${column}`)
  while (value > 0) {
    const remainder = (value - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    value = Math.floor((value - 1) / 26)
  }
  return result
}

function makeCell(before: Cell | undefined, value: CellValue): Cell | undefined {
  const cell: Cell = { value: structuredClone(value), ...(before?.style ? { style: before.style } : {}) }
  return isUnallocatedBlank(cell) ? undefined : cell
}

function makeFormattedCell(before: Cell | undefined, style: CellStyle | null): Cell | undefined {
  if (!before && style === null) return undefined
  const cell: Cell = { value: before?.value ?? { kind: 'blank' }, ...(style ? { style: structuredClone(style) } : {}) }
  return isUnallocatedBlank(cell) ? undefined : cell
}

function equalCell(before?: Cell, after?: Cell): boolean {
  return sameValue(before, after)
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (left instanceof Map || right instanceof Map) {
    return left instanceof Map && right instanceof Map && sameMap(left, right)
  }
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

function sameMap<K, V>(left: ReadonlyMap<K, V>, right: ReadonlyMap<K, V>): boolean {
  if (left.size !== right.size) return false
  for (const [key, value] of left) if (!sameValue(value, right.get(key))) return false
  return true
}

function addCellPatch(addPatch: (patch: WorkbookPatch) => void, sheetId: string, changes: CellPatchChange[]): void {
  if (changes.length) addPatch({ kind: 'cells', sheetId, changes })
}

function addUsedRangePatch(
  addPatch: (patch: WorkbookPatch) => void,
  sheet: Worksheet,
  changes: Map<string, CellPatchChange>,
): void {
  const previous = sheet.dimensions.usedRange
  let usedRange = previous ? cloneRange(previous) : null
  let requiresRescan = false
  for (const change of changes.values()) {
    const address = parseCellAddress(change.address)
    if (change.after) {
      if (!usedRange)
        usedRange = {
          start: { row: address.row, column: address.column },
          end: { row: address.row, column: address.column },
        }
      else {
        usedRange.start.row = Math.min(usedRange.start.row, address.row)
        usedRange.start.column = Math.min(usedRange.start.column, address.column)
        usedRange.end.row = Math.max(usedRange.end.row, address.row)
        usedRange.end.column = Math.max(usedRange.end.column, address.column)
      }
    } else if (
      previous &&
      change.before &&
      (address.row === previous.start.row ||
        address.row === previous.end.row ||
        address.column === previous.start.column ||
        address.column === previous.end.column)
    ) {
      requiresRescan = true
    }
  }
  if (requiresRescan) {
    const nextCells = new Map(sheet.cells)
    for (const change of changes.values()) {
      if (change.after) nextCells.set(change.address, change.after)
      else nextCells.delete(change.address)
    }
    usedRange = getUsedRange(nextCells, sheet.merges)
  }
  if (sameValue(sheet.dimensions.usedRange, usedRange)) return
  addPatch({
    kind: 'worksheet-field',
    sheetId: sheet.id,
    field: 'dimensions',
    before: sheet.dimensions,
    after: { ...sheet.dimensions, usedRange },
  })
}

function boundingRange(addresses: string[]): CellRange {
  let minRow = MAX_ROWS
  let minColumn = MAX_COLUMNS
  let maxRow = 1
  let maxColumn = 1
  for (const value of addresses) {
    const address = parseCellAddress(value)
    minRow = Math.min(minRow, address.row)
    minColumn = Math.min(minColumn, address.column)
    maxRow = Math.max(maxRow, address.row)
    maxColumn = Math.max(maxColumn, address.column)
  }
  return {
    start: { row: minRow, column: minColumn },
    end: { row: maxRow, column: maxColumn },
  }
}

function assertAxis(value: number, min: number, max: number, label: string): void {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${label} must be an integer between ${min} and ${max}.`)
}

function transformCellMap(
  cells: ReadonlyMap<string, Cell>,
  axis: 'row' | 'column',
  start: number,
  count: number,
  insert: boolean,
): Map<string, Cell> {
  const result = new Map<string, Cell>()
  const end = start + count - 1
  for (const [key, cell] of cells) {
    const address = parseCellAddress(key)
    const coordinate = axis === 'row' ? address.row : address.column
    if (!insert && coordinate >= start && coordinate <= end) continue
    const moved = coordinate >= (insert ? start : end + 1) ? coordinate + (insert ? count : -count) : coordinate
    if (moved < 1 || moved > (axis === 'row' ? MAX_ROWS : MAX_COLUMNS))
      throw new Error('The operation exceeds worksheet limits.')
    const nextAddress = axis === 'row' ? { ...address, row: moved } : { ...address, column: moved }
    result.set(cellAddressKey(nextAddress), cell)
  }
  return result
}

function diffCellMaps(before: ReadonlyMap<string, Cell>, after: ReadonlyMap<string, Cell>): CellPatchChange[] {
  const keys = new Set([...before.keys(), ...after.keys()])
  const changes: CellPatchChange[] = []
  for (const address of keys) {
    const oldCell = before.get(address)
    const newCell = after.get(address)
    if (!equalCell(oldCell, newCell)) changes.push({ address, before: oldCell, after: newCell })
  }
  return changes.sort((left, right) =>
    compareCellAddresses(parseCellAddress(left.address), parseCellAddress(right.address)),
  )
}

function markFormulasStale(cells: Map<string, Cell>): Map<string, Cell> {
  for (const [address, cell] of cells) {
    if (cell.value.kind !== 'formula' || cell.value.formula.calculationStatus === 'stale') continue
    cells.set(address, {
      ...cell,
      value: {
        ...cell.value,
        formula: { ...cell.value.formula, calculationStatus: 'stale' },
      },
    })
  }
  return cells
}

function markWorksheetFormulaCellsStale(
  sheet: Worksheet,
  addPatch: (patch: WorkbookPatch) => void,
  dirtyRegions: DirtyRegion[],
  affected: Set<string>,
): void {
  const after = markFormulasStale(new Map(sheet.cells))
  const changes = diffCellMaps(sheet.cells, after)
  addCellPatch(addPatch, sheet.id, changes)
  if (changes.length) {
    dirtyRegions.push(
      ...cellDirtyRegions(
        sheet.id,
        changes.map((change) => change.address),
      ),
    )
    affected.add(sheet.id)
  }
}

function markFormulaDependentsStale(
  workbook: Workbook,
  editedSheetId: string,
  changedAddresses: string[],
  editedSheetCells: Map<string, Cell>,
  addPatch: (patch: WorkbookPatch) => void,
  dirtyRegions: DirtyRegion[],
  affected: Set<string>,
): void {
  const sheetIdsByName = new Map(
    [...workbook.sheetsById.values()].map((sheet) => [sheet.name.toLocaleLowerCase('en-US'), sheet.id]),
  )
  const formulaNodes: Array<{ key: string; sheetId: string; address: string; cell: Cell }> = []
  for (const id of workbook.sheetOrder) {
    const sheet = workbook.sheetsById.get(id)!
    const cells = id === editedSheetId ? editedSheetCells : sheet.cells
    for (const [address, cell] of cells) {
      if (cell.value.kind !== 'formula') continue
      const key = `${id}!${address}`
      formulaNodes.push({ key, sheetId: id, address, cell })
    }
  }
  if (formulaNodes.length === 0) return

  const reverse = new Map<string, Set<string>>()
  const ranged: Array<{ sheetId: string; range: CellRange; dependentKey: string }> = []
  let unknownFormulaAst = false
  for (const formula of formulaNodes) {
    const ast = formula.cell.value.kind === 'formula' ? formula.cell.value.formula.ast : null
    if (!ast) {
      unknownFormulaAst = true
      continue
    }
    const references = formulaReferences(ast)
    for (const reference of references) {
      const targetSheetId = reference.sheetName
        ? sheetIdsByName.get(reference.sheetName.toLocaleLowerCase('en-US'))
        : formula.sheetId
      if (!targetSheetId) continue
      const start = reference.range.start
      const end = reference.range.end
      if (start.row === end.row && start.column === end.column) {
        const key = `${targetSheetId}!${cellAddressKey(start)}`
        const dependents = reverse.get(key) ?? new Set<string>()
        dependents.add(formula.key)
        reverse.set(key, dependents)
      } else {
        ranged.push({ sheetId: targetSheetId, range: reference.range, dependentKey: formula.key })
      }
    }
  }

  const seeds = changedAddresses.map((address) => `${editedSheetId}!${cellAddressKey(parseCellAddress(address))}`)
  const affectedFormulaKeys = new Set<string>()
  const visitedCells = new Set(seeds)
  const queue = [...seeds]
  if (unknownFormulaAst) {
    for (const formula of formulaNodes) affectedFormulaKeys.add(formula.key)
  } else {
    while (queue.length) {
      const key = queue.shift()!
      for (const dependentKey of reverse.get(key) ?? []) {
        if (affectedFormulaKeys.has(dependentKey)) continue
        affectedFormulaKeys.add(dependentKey)
        if (!visitedCells.has(dependentKey)) {
          visitedCells.add(dependentKey)
          queue.push(dependentKey)
        }
      }
      const separator = key.lastIndexOf('!')
      const sheetId = key.slice(0, separator)
      const address = parseCellAddress(key.slice(separator + 1))
      for (const dependency of ranged) {
        if (dependency.sheetId !== sheetId || !isAddressInRange(address, dependency.range)) continue
        if (affectedFormulaKeys.has(dependency.dependentKey)) continue
        affectedFormulaKeys.add(dependency.dependentKey)
        if (!visitedCells.has(dependency.dependentKey)) {
          visitedCells.add(dependency.dependentKey)
          queue.push(dependency.dependentKey)
        }
      }
    }
  }

  const cellsBySheet = new Map<string, Map<string, Cell>>()
  for (const key of affectedFormulaKeys) {
    const separator = key.lastIndexOf('!')
    const sheetId = key.slice(0, separator)
    const address = key.slice(separator + 1)
    const source = sheetId === editedSheetId ? editedSheetCells : workbook.sheetsById.get(sheetId)!.cells
    const cell = source.get(address)
    if (!cell || cell.value.kind !== 'formula' || cell.value.formula.calculationStatus === 'stale') continue
    const nextCells = cellsBySheet.get(sheetId) ?? new Map(source)
    nextCells.set(address, {
      ...cell,
      value: {
        ...cell.value,
        formula: { ...cell.value.formula, calculationStatus: 'stale' },
      },
    })
    cellsBySheet.set(sheetId, nextCells)
  }

  for (const [sheetId, nextCells] of cellsBySheet) {
    const source = sheetId === editedSheetId ? editedSheetCells : workbook.sheetsById.get(sheetId)!.cells
    const changes = diffCellMaps(source, nextCells)
    addCellPatch(addPatch, sheetId, changes)
    if (changes.length) {
      dirtyRegions.push(
        ...cellDirtyRegions(
          sheetId,
          changes.map((change) => change.address),
        ),
      )
      affected.add(sheetId)
    }
  }
}

function formulaReferences(node: FormulaAstNode): Array<{ sheetName?: string; range: CellRange }> {
  switch (node.type) {
    case 'reference':
      return [{ sheetName: node.sheetName, range: { start: node.address, end: node.address } }]
    case 'range':
      return [{ sheetName: node.sheetName, range: node.range }]
    case 'unary':
      return formulaReferences(node.operand)
    case 'binary':
      return [...formulaReferences(node.left), ...formulaReferences(node.right)]
    case 'call':
      return node.arguments.flatMap(formulaReferences)
    case 'literal':
    case 'error':
      return []
  }
}

function markOtherFormulaCellsStale(
  workbook: Workbook,
  excludedSheetId: string,
  addPatch: (patch: WorkbookPatch) => void,
  dirtyRegions: DirtyRegion[],
  affected: Set<string>,
): void {
  for (const id of workbook.sheetOrder) {
    if (id === excludedSheetId) continue
    const sheet = workbook.sheetsById.get(id)!
    markWorksheetFormulaCellsStale(sheet, addPatch, dirtyRegions, affected)
  }
}

function markWorkbookFormulaCellsStale(
  workbook: Workbook,
  addPatch: (patch: WorkbookPatch) => void,
  dirtyRegions: DirtyRegion[],
  affected: Set<string>,
): void {
  for (const id of workbook.sheetOrder)
    markWorksheetFormulaCellsStale(workbook.sheetsById.get(id)!, addPatch, dirtyRegions, affected)
}

function shiftMetadata<T>(
  metadata: ReadonlyMap<number, T>,
  start: number,
  count: number,
  insert: boolean,
  limit: number,
): Map<number, T> {
  const result = new Map<number, T>()
  const end = start + count - 1
  for (const [index, value] of metadata) {
    if (!insert && index >= start && index <= end) continue
    const next = index >= (insert ? start : end + 1) ? index + (insert ? count : -count) : index
    if (next < 1 || next > limit) throw new Error('The operation exceeds worksheet limits.')
    result.set(next, value)
  }
  return result
}

function transformRange(
  range: CellRange,
  axis: 'row' | 'column',
  start: number,
  count: number,
  insert: boolean,
): CellRange | undefined {
  const startValue = axis === 'row' ? range.start.row : range.start.column
  const endValue = axis === 'row' ? range.end.row : range.end.column
  const deleteEnd = start + count - 1
  let nextStart = startValue
  let nextEnd = endValue
  if (insert) {
    if (startValue >= start) {
      nextStart += count
      nextEnd += count
    } else if (endValue >= start) nextEnd += count
  } else {
    const overlapStart = Math.max(startValue, start)
    const overlapEnd = Math.min(endValue, deleteEnd)
    const removed = Math.max(0, overlapEnd - overlapStart + 1)
    if (removed === endValue - startValue + 1) return undefined
    nextStart = startValue >= deleteEnd + 1 ? startValue - count : startValue >= start ? start : startValue
    nextEnd = nextStart + (endValue - startValue + 1 - removed) - 1
    if (startValue >= deleteEnd + 1) nextEnd = endValue - count
  }
  if (axis === 'row') return { start: { ...range.start, row: nextStart }, end: { ...range.end, row: nextEnd } }
  return { start: { ...range.start, column: nextStart }, end: { ...range.end, column: nextEnd } }
}

function transformDescriptor<T extends { range: CellRange }>(
  items: readonly T[],
  axis: 'row' | 'column',
  start: number,
  count: number,
  insert: boolean,
): T[] {
  return items.map((item) => {
    const range = transformRange(item.range, axis, start, count, insert)
    if (range) validateRange(range)
    return {
      ...item,
      range: range ?? item.range,
      rangeStatus: range && (item as T & { rangeStatus?: string }).rangeStatus !== 'unsafe' ? 'safe' : 'unsafe',
    } as T
  })
}

function transformWorksheetProperties(
  sheet: Worksheet,
  axis: 'row' | 'column',
  start: number,
  count: number,
  insert: boolean,
  cells: Map<string, Cell>,
): Array<[string, unknown]> {
  const limit = axis === 'row' ? MAX_ROWS : MAX_COLUMNS
  const merges = sheet.merges.flatMap((range) => {
    const transformed = transformRange(range, axis, start, count, insert)
    if (transformed) validateRange(transformed)
    return transformed &&
      (transformed.start.row !== transformed.end.row || transformed.start.column !== transformed.end.column)
      ? [transformed]
      : []
  })
  const drawings = transformDescriptor(sheet.drawings, axis, start, count, insert).map((drawing) => ({
    ...drawing,
    preservationStatus: 'unsafe' as const,
  }))
  const pivots = transformDescriptor(sheet.pivots, axis, start, count, insert).map((pivot) => ({
    ...pivot,
    preservationStatus: 'unsafe' as const,
    refreshRequired: true,
  }))
  const dimensions = { ...sheet.dimensions, usedRange: getUsedRange(cells, merges) }
  return [
    ['merges', merges],
    ['rowMetadata', axis === 'row' ? shiftMetadata(sheet.rowMetadata, start, count, insert, limit) : sheet.rowMetadata],
    [
      'columnMetadata',
      axis === 'column' ? shiftMetadata(sheet.columnMetadata, start, count, insert, limit) : sheet.columnMetadata,
    ],
    ['tables', transformDescriptor(sheet.tables, axis, start, count, insert)],
    ['validations', transformDescriptor(sheet.validations, axis, start, count, insert)],
    ['conditionalFormats', transformDescriptor(sheet.conditionalFormats, axis, start, count, insert)],
    ['drawings', drawings],
    ['pivots', pivots],
    ['dimensions', dimensions],
  ]
}

function getWorksheetField(sheet: Worksheet, field: string): unknown {
  return (sheet as unknown as Record<string, unknown>)[field]
}

function transformDefinedNames(
  workbook: Workbook,
  sheetId: string,
  axis: 'row' | 'column',
  start: number,
  count: number,
  insert: boolean,
) {
  return workbook.definedNames.map((name) => {
    if ((name.targetSheetId ?? name.scopeSheetId) !== sheetId || !name.range) return { ...name, stale: true }
    const range = transformRange(name.range, axis, start, count, insert)
    if (range) validateRange(range)
    return {
      ...name,
      ...(range ? { range } : {}),
      rangeStatus: range && name.rangeStatus !== 'unsafe' ? ('safe' as const) : ('unsafe' as const),
      stale: true,
    }
  })
}

function addPreservationInvalidation(
  workbook: Workbook,
  impacts: PreservationImpact[],
  reason: string,
  patches: WorkbookPatch[],
): void {
  const preservation = workbook.preservation
  if (!preservation) return
  const impactSet = new Set(impacts)
  let changed = false
  const parts = preservation.parts.map((part) => {
    const isAffected =
      part.dependsOn.includes('all') || impactSet.has('all') || part.dependsOn.some((impact) => impactSet.has(impact))
    if (!isAffected) return part
    const previousImpacts = new Set(part.invalidatedBy ?? [])
    const invalidatedBy = [...new Set([...previousImpacts, ...impacts])]
    const hasNewImpacts = impacts.some((impact) => !previousImpacts.has(impact))
    if (part.status === 'unsafe' && !hasNewImpacts) return part
    changed = true
    return {
      ...part,
      status: 'unsafe' as const,
      unsafeReasons: [...part.unsafeReasons, `Workbook ${reason} changed ${impacts.join(', ')}.`],
      invalidatedBy,
    }
  })
  if (changed) {
    patches.push({
      kind: 'workbook-field',
      field: 'preservation',
      before: preservation,
      after: { ...preservation, parts },
    })
  }
}

function rangeKey(range: CellRange): string {
  return `${cellAddressKey(range.start)}:${cellAddressKey(range.end)}`
}

function sheetNames(workbook: Workbook, exceptId?: string): string[] {
  return workbook.sheetOrder.flatMap((id) => {
    const sheet = workbook.sheetsById.get(id)
    return sheet && id !== exceptId ? [sheet.name] : []
  })
}

function insertionIndex(index: number | undefined, fallback: number, max: number): number {
  const value = index ?? fallback
  if (!Number.isInteger(value) || value < 0 || value > max) throw new Error(`Sheet index must be between 0 and ${max}.`)
  return value
}

function uniqueTableName(workbook: Workbook, name: string, suffix: number): string {
  const used = new Set(
    [...workbook.sheetsById.values()].flatMap((sheet) => sheet.tables.map((table) => table.name.toLowerCase())),
  )
  let candidate = `${name}_copy${suffix > 1 ? suffix : ''}`
  let serial = 2
  while (used.has(candidate.toLowerCase())) candidate = `${name}_copy${serial++}`
  return candidate
}

function labelFor(action: WorkbookAction): string {
  const labels: Record<WorkbookAction['type'], string> = {
    'set-chart': 'Create or edit chart',
    'place-chart': 'Move or resize chart',
    'remove-chart': 'Remove chart',
    'create-table': 'Create table',
    'convert-table': 'Convert table to range',
    'set-auto-filter': 'AutoFilter',
    'set-frozen-panes': 'Freeze panes',
    'sort-range': 'Sort range',
    'add-defined-name': 'Define name',
    'delete-defined-name': 'Delete defined name',
    'set-cells': 'Edit cells',
    'format-cells': 'Format cells',
    'set-row-metadata': 'Change row settings',
    'set-column-metadata': 'Change column settings',
    'insert-rows': 'Insert rows',
    'delete-rows': 'Delete rows',
    'insert-columns': 'Insert columns',
    'delete-columns': 'Delete columns',
    merge: 'Merge cells',
    unmerge: 'Unmerge cells',
    'create-sheet': 'Create worksheet',
    'rename-sheet': 'Rename worksheet',
    'delete-sheet': 'Delete worksheet',
    'move-sheet': 'Move worksheet',
    'duplicate-sheet': 'Duplicate worksheet',
  }
  return labels[action.type]
}

function deduplicateDirtyRegions(regions: DirtyRegion[]): DirtyRegion[] {
  const keys = new Set<string>()
  return regions.filter((region) => {
    const key = JSON.stringify(region)
    if (keys.has(key)) return false
    keys.add(key)
    return true
  })
}

function estimateAny(value: unknown): number {
  if (value === null || value === undefined) return 4
  if (typeof value === 'string') return value.length * 2 + 8
  if (typeof value === 'number' || typeof value === 'boolean') return 8
  if (value instanceof Uint8Array) return value.byteLength
  if (value instanceof Map) {
    let size = 16
    for (const [key, item] of value) size += estimateAny(key) + estimateAny(item)
    return size
  }
  if (Array.isArray(value)) return 16 + value.reduce((total, item) => total + estimateAny(item), 0)
  if (typeof value === 'object') {
    let size = 32
    for (const [key, item] of Object.entries(value)) size += estimateAny(key) + estimateAny(item)
    return size
  }
  return 8
}

export function estimatePatchBytes(patches: readonly WorkbookPatch[]): number {
  return patches.reduce((total, patch) => {
    if (patch.kind !== 'workbook-field' || patch.field !== 'preservation') return total + estimateAny(patch)
    const before = patch.before as Workbook['preservation']
    const after = patch.after as Workbook['preservation']
    const descriptors = [...(before?.parts ?? []), ...(after?.parts ?? [])].map((part) => ({
      partName: part.partName,
      contentType: part.contentType,
      relationshipIds: part.relationshipIds,
      dependsOn: part.dependsOn,
      status: part.status,
      unsafeReasons: part.unsafeReasons,
    }))
    return total + estimateAny(descriptors) + 64
  }, 0)
}

export function applyWorkbookPatch(workbook: Workbook, patch: WorkbookPatch, direction: 'forward' | 'backward'): void {
  const afterSide = direction === 'forward' ? 'after' : 'before'
  switch (patch.kind) {
    case 'cells': {
      const sheet = requireSheet(workbook, patch.sheetId)
      for (const change of patch.changes) sheet.cells.delete(change.address)
      for (const change of patch.changes) {
        const value = change[afterSide]
        if (value) sheet.cells.set(change.address, value)
      }
      return
    }
    case 'worksheet-field': {
      const sheet = requireSheet(workbook, patch.sheetId)
      ;(sheet as unknown as Record<string, unknown>)[patch.field] = patch[direction === 'forward' ? 'after' : 'before']
      return
    }
    case 'sheet-record': {
      const value = patch[afterSide]
      if (value) workbook.sheetsById.set(patch.sheetId, value)
      else workbook.sheetsById.delete(patch.sheetId)
      return
    }
    case 'sheet-order':
      workbook.sheetOrder = patch[direction === 'forward' ? 'after' : 'before']
      return
    case 'workbook-field':
      ;(workbook as unknown as Record<string, unknown>)[patch.field] =
        patch[direction === 'forward' ? 'after' : 'before']
      return
  }
}

export function rangesForCells(changes: readonly CellPatchChange[]): CellRange | undefined {
  if (!changes.length) return undefined
  return boundingRange(changes.map((change) => change.address))
}

function cellDirtyRegions(sheetId: string, addresses: string[]): DirtyRegion[] {
  const byRow = new Map<number, number[]>()
  for (const value of addresses) {
    const address = parseCellAddress(value)
    const columns = byRow.get(address.row) ?? []
    columns.push(address.column)
    byRow.set(address.row, columns)
  }
  const regions: CellRange[] = []
  let active = new Map<string, CellRange>()
  let previousRow = 0
  for (const [row, columns] of [...byRow].sort(([left], [right]) => left - right)) {
    columns.sort((left, right) => left - right)
    const spans: Array<{ start: number; end: number }> = []
    for (const column of columns) {
      const last = spans[spans.length - 1]
      if (last && column <= last.end + 1) last.end = column
      else spans.push({ start: column, end: column })
    }
    const nextActive = new Map<string, CellRange>()
    for (const span of spans) {
      const key = `${span.start}:${span.end}`
      const previous = row === previousRow + 1 ? active.get(key) : undefined
      if (previous) {
        previous.end.row = row
        nextActive.set(key, previous)
      } else {
        const range = { start: { row, column: span.start }, end: { row, column: span.end } }
        regions.push(range)
        if (regions.length > 256) return [{ kind: 'sheet', sheetId }]
        nextActive.set(key, range)
      }
    }
    active = nextActive
    previousRow = row
  }
  return regions.map((range) => ({ kind: 'cells', sheetId, range }))
}

export function cellExistsInRange(address: CellAddress, range: CellRange): boolean {
  return isAddressInRange(address, range)
}
