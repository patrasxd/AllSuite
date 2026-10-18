import {
  AddressError,
  WorkbookInvariantError,
  WorkbookSession,
  addDefinedName,
  columnNameToNumber,
  columnNumberToName,
  createOpaquePartDescriptor,
  createWorkbook,
  dateToSerial,
  formatCellAddress,
  formatSheetQualifiedAddress,
  parseCellAddress,
  parseRangeAddress,
  parseSheetQualifiedAddress,
  resolveSheet,
  serialToDateParts,
} from './index'
import type { Formula, OOXMLPreservationState } from './index'

function freshSession() {
  const workbook = createWorkbook({ firstSheetName: 'Input', idFactory: (kind) => `${kind}-1` })
  let nextId = 1
  return { workbook, session: new WorkbookSession(workbook, { idFactory: (kind) => `${kind}-${++nextId}` }) }
}

describe('Grid workbook addresses', () => {
  it('converts A1 columns and retains absolute markers', () => {
    expect(columnNameToNumber('A')).toBe(1)
    expect(columnNameToNumber('Z')).toBe(26)
    expect(columnNameToNumber('AA')).toBe(27)
    expect(columnNumberToName(16_384)).toBe('XFD')
    const address = parseCellAddress('$XFD$1048576')
    expect(address).toEqual({ row: 1_048_576, column: 16_384, absoluteColumn: true, absoluteRow: true })
    expect(formatCellAddress(address)).toBe('$XFD$1048576')
  })

  it('parses ranges and rejects invalid or out-of-bounds coordinates', () => {
    expect(parseRangeAddress('$A$1:B7')).toEqual({
      start: { row: 1, column: 1, absoluteColumn: true, absoluteRow: true },
      end: { row: 7, column: 2, absoluteColumn: false, absoluteRow: false },
    })
    expect(() => parseCellAddress('XFE1')).toThrow(AddressError)
    expect(() => parseCellAddress('A1048577')).toThrow(AddressError)
    expect(() => parseCellAddress('A0')).toThrow(AddressError)
    expect(() => parseRangeAddress('B2:A1')).toThrow(AddressError)
  })

  it('parses quoted cross-sheet references with escaped apostrophes and exclamation marks', () => {
    const qualified = parseSheetQualifiedAddress("'O''Brien!Data'!$B$3:C8")
    expect(qualified.sheetName).toBe("O'Brien!Data")
    expect(formatSheetQualifiedAddress(qualified.sheetName, qualified.range)).toBe("'O''Brien!Data'!$B$3:C8")
    expect(parseSheetQualifiedAddress('Summary!A1').sheetName).toBe('Summary')
    expect(() => parseSheetQualifiedAddress("'unclosed!A1")).toThrow(AddressError)
    expect(() => parseSheetQualifiedAddress("'Bad/Name'!A1")).toThrow(AddressError)
  })
})

describe('Grid sparse workbook model', () => {
  it('allocates only populated or formatted cells', () => {
    const { session, workbook } = freshSession()
    const sheet = workbook.sheetsById.get(workbook.activeSheetId)!
    expect(sheet.cells.size).toBe(0)
    session.setCell(sheet.id, 'B2', { kind: 'number', value: 4 })
    expect(sheet.cells.size).toBe(1)
    expect(session.getCell(sheet.id, 'B2')?.value).toEqual({ kind: 'number', value: 4 })
    expect(session.getRange(sheet.id, 'A1:XFD1048576').cells.size).toBe(1)
    session.setCell(sheet.id, 'B2', { kind: 'blank' })
    expect(sheet.cells.size).toBe(0)
    expect(sheet.dimensions.usedRange).toBeNull()
    session.formatCells(sheet.id, [{ address: 'C3', style: { font: { bold: true } } }])
    expect(sheet.cells.size).toBe(1)
    expect(sheet.cells.get('C3')?.value.kind).toBe('blank')
  })

  it('clears a cell value while preserving its formatting', () => {
    const { session, workbook } = freshSession()
    const sheetId = workbook.activeSheetId
    session.setCell(sheetId, 'C3', { kind: 'number', value: 8 })
    session.formatCells(sheetId, [{ address: 'C3', style: { font: { bold: true }, fill: { color: '#eee' } } }])

    session.setCell(sheetId, 'C3', { kind: 'blank' })
    expect(session.getCell(sheetId, 'C3')).toMatchObject({
      value: { kind: 'blank' },
      style: { font: { bold: true }, fill: { color: '#eee' } },
    })
    expect(session.undo()).toBe(true)
    expect(session.getCell(sheetId, 'C3')).toMatchObject({ value: { kind: 'number', value: 8 } })
  })

  it('resolves cross-sheet names without conflating ids and names', () => {
    const workbook = createWorkbook({ firstSheetName: "R&D's Data", idFactory: () => 'sheet-a' })
    const session = new WorkbookSession(workbook)
    const otherId = session.createSheet('Summary')
    expect(resolveSheet(workbook, "R&D's Data").id).toBe('sheet-a')
    expect(resolveSheet(workbook, otherId).name).toBe('Summary')
    const names = addDefinedName(workbook, {
      name: 'SalesTotal',
      scopeSheetId: otherId,
      range: parseRangeAddress('B2:B8'),
    })
    expect(names).toHaveLength(1)
    expect(() => addDefinedName(workbook, { name: 'A1' })).toThrow(WorkbookInvariantError)
    expect(() => session.createSheet('summary')).toThrow(WorkbookInvariantError)
    expect(() => session.createSheet('Bad/Name')).toThrow(WorkbookInvariantError)
    const defaultWorkbook = createWorkbook()
    const defaultSession = new WorkbookSession(defaultWorkbook)
    const initialSheetId = defaultWorkbook.activeSheetId
    expect(defaultSession.createSheet('Next')).not.toBe(initialSheetId)
  })

  it('merges and unmerges ranges while rejecting overlap', () => {
    const { session, workbook } = freshSession()
    const sheetId = workbook.activeSheetId
    session.merge(sheetId, 'A1:B2')
    expect(workbook.sheetsById.get(sheetId)?.merges).toHaveLength(1)
    expect(() => session.merge(sheetId, 'B2:C3')).toThrow(WorkbookInvariantError)
    session.unmerge(sheetId, 'A1:B2')
    expect(workbook.sheetsById.get(sheetId)?.merges).toHaveLength(0)
    expect(session.undo()).toBe(true)
    expect(workbook.sheetsById.get(sheetId)?.merges).toHaveLength(1)
  })
})

describe('Grid workbook commands and history', () => {
  it('treats a multi-cell edit as one reversible undo step', () => {
    const { session, workbook } = freshSession()
    const sheetId = workbook.activeSheetId
    session.setCells(sheetId, [
      { address: 'A1', value: { kind: 'string', value: 'one' } },
      { address: 'B2', value: { kind: 'number', value: 2 } },
    ])
    expect(session.historyState.undoDepth).toBe(1)
    expect(session.undo()).toBe(true)
    expect(session.getCell(sheetId, 'A1')).toBeUndefined()
    expect(session.getCell(sheetId, 'B2')).toBeUndefined()
    expect(session.redo()).toBe(true)
    expect(session.getCell(sheetId, 'B2')?.value).toEqual({ kind: 'number', value: 2 })
  })

  it('validates bulk input before changing any cells', () => {
    const { session, workbook } = freshSession()
    const sheetId = workbook.activeSheetId
    expect(() =>
      session.setCells(sheetId, [
        { address: 'A1', value: { kind: 'string', value: 'must not apply' } },
        { address: 'XFE1', value: { kind: 'number', value: 1 } },
      ]),
    ).toThrow(AddressError)
    expect(session.getCell(sheetId, 'A1')).toBeUndefined()
    expect(session.historyState.undoDepth).toBe(0)
  })

  it('sets a sparse range atomically and clears omitted populated cells', () => {
    const { session, workbook } = freshSession()
    const sheetId = workbook.activeSheetId
    session.setCells(sheetId, [
      { address: 'A1', value: { kind: 'string', value: 'old' } },
      { address: 'B1', value: { kind: 'string', value: 'clear' } },
    ])
    session.markClean()
    session.setRange(sheetId, 'A1:B1', new Map([['A1', { kind: 'string', value: 'new' }]]))
    expect(session.historyState.undoDepth).toBe(2)
    expect(session.getCell(sheetId, 'B1')).toBeUndefined()
    expect(session.undo()).toBe(true)
    expect(session.getCell(sheetId, 'A1')?.value).toEqual({ kind: 'string', value: 'old' })
    expect(session.getCell(sheetId, 'B1')?.value).toEqual({ kind: 'string', value: 'clear' })
    expect(session.isDirty).toBe(false)
  })

  it('supports reversible row and column shifts, metadata, names, merges and preservation invalidation', () => {
    const { session, workbook } = freshSession()
    const sheetId = workbook.activeSheetId
    const sheet = workbook.sheetsById.get(sheetId)!
    const formula: Formula = {
      source: '=SUM(A1:A3)',
      canonicalExpression: '=SUM(A1:A3)',
      ast: null,
      cachedResult: { kind: 'number', value: 6 },
      calculationStatus: 'fresh',
    }
    workbook.definedNames = addDefinedName(workbook, {
      name: 'InputBlock',
      scopeSheetId: sheetId,
      range: parseRangeAddress('A2:B3'),
    })
    session.setCells(sheetId, [
      { address: 'A1', value: { kind: 'formula', formula } },
      { address: 'A2', value: { kind: 'number', value: 2 } },
      { address: 'B3', value: { kind: 'number', value: 3 } },
    ])
    session.setRowMetadata(sheetId, 3, { height: 28 })
    session.merge(sheetId, 'C3:D4')
    const preservation: OOXMLPreservationState = {
      originalArchiveBytes: new Uint8Array([80, 75, 3, 4]),
      parts: [createOpaquePartDescriptor({ partName: 'customXml/item1.xml', originalBytes: new Uint8Array([7, 8]) })],
    }
    workbook.preservation = preservation
    session.insertRows(sheetId, 2, 1)
    expect(session.getCell(sheetId, 'A1')?.value).toMatchObject({
      kind: 'formula',
      formula: { calculationStatus: 'stale' },
    })
    expect(session.getCell(sheetId, 'A3')?.value).toEqual({ kind: 'number', value: 2 })
    expect(session.getCell(sheetId, 'B4')?.value).toEqual({ kind: 'number', value: 3 })
    expect(sheet.rowMetadata.get(4)).toEqual({ height: 28 })
    expect(sheet.merges[0]).toEqual(parseRangeAddress('C4:D5'))
    expect(workbook.definedNames[0]).toMatchObject({ range: parseRangeAddress('A3:B4'), stale: true })
    expect(workbook.preservation?.parts[0].status).toBe('unsafe')
    expect([...workbook.preservation!.parts[0].originalBytes!]).toEqual([7, 8])
    expect(session.undo()).toBe(true)
    expect(session.getCell(sheetId, 'A2')?.value).toEqual({ kind: 'number', value: 2 })
    expect(sheet.rowMetadata.get(3)).toEqual({ height: 28 })
    expect(sheet.merges[0]).toEqual(parseRangeAddress('C3:D4'))
    expect(workbook.definedNames[0]).toEqual({
      name: 'InputBlock',
      scopeSheetId: sheetId,
      range: parseRangeAddress('A2:B3'),
    })
    expect(workbook.preservation?.parts[0].status).toBe('safe')
    expect(session.redo()).toBe(true)
    session.deleteColumns(sheetId, 1, 1)
    expect(session.getCell(sheetId, 'A4')?.value).toEqual({ kind: 'number', value: 3 })
    expect(session.undo()).toBe(true)
    expect(session.getCell(sheetId, 'B4')?.value).toEqual({ kind: 'number', value: 3 })
    session.insertColumns(sheetId, 2, 2)
    expect(session.getCell(sheetId, 'D4')?.value).toEqual({ kind: 'number', value: 3 })
    expect(sheet.merges[0]).toEqual(parseRangeAddress('E4:F5'))
    expect(session.undo()).toBe(true)
    expect(session.getCell(sheetId, 'B4')?.value).toEqual({ kind: 'number', value: 3 })
    expect(sheet.merges[0]).toEqual(parseRangeAddress('C4:D5'))
  })

  it('treats a multi-row structural operation as one undo and redo step', () => {
    const { session, workbook } = freshSession()
    const sheetId = workbook.activeSheetId
    session.setCells(sheetId, [
      { address: 'A2', value: { kind: 'string', value: 'first' } },
      { address: 'A3', value: { kind: 'string', value: 'second' } },
    ])

    session.insertRows(sheetId, 2, 3)
    expect(session.historyState.undoDepth).toBe(2)
    expect(session.getCell(sheetId, 'A5')?.value).toEqual({ kind: 'string', value: 'first' })
    expect(session.getCell(sheetId, 'A6')?.value).toEqual({ kind: 'string', value: 'second' })
    expect(session.undo()).toBe(true)
    expect(session.historyState.undoDepth).toBe(1)
    expect(session.getCell(sheetId, 'A2')?.value).toEqual({ kind: 'string', value: 'first' })
    expect(session.getCell(sheetId, 'A3')?.value).toEqual({ kind: 'string', value: 'second' })
    expect(session.getCell(sheetId, 'A5')).toBeUndefined()
    expect(session.redo()).toBe(true)
    expect(session.getCell(sheetId, 'A6')?.value).toEqual({ kind: 'string', value: 'second' })
  })

  it('supports sheet create, rename, move, duplicate and delete with undo', () => {
    const { session, workbook } = freshSession()
    const firstId = workbook.activeSheetId
    session.setCell(firstId, 'A1', { kind: 'number', value: 1 })
    expect(() => session.createSheet('OutOfRange', 4)).toThrow(/index/)
    expect(workbook.sheetOrder).toEqual([firstId])
    const secondId = session.createSheet('Second')
    session.renameSheet(secondId, 'Renamed')
    session.moveSheet(secondId, 0)
    const duplicateId = session.duplicateSheet(firstId, 'Copy')
    expect(workbook.sheetOrder).toEqual([secondId, firstId, duplicateId])
    expect(session.getCell(duplicateId, 'A1')?.value).toEqual({ kind: 'number', value: 1 })
    session.deleteSheet(secondId)
    expect(workbook.sheetsById.has(secondId)).toBe(false)
    expect(session.undo()).toBe(true)
    expect(workbook.sheetsById.get(secondId)?.name).toBe('Renamed')
  })

  it('retains modeled table and pivot descriptors when a structural edit removes their ranges', () => {
    const { session, workbook } = freshSession()
    const sheet = workbook.sheetsById.get(workbook.activeSheetId)!
    sheet.tables = [
      {
        id: 'table-1',
        name: 'DataTable',
        range: parseRangeAddress('A2:B3'),
        columns: [{ id: 'column-1', name: 'Value' }],
      },
    ]
    sheet.pivots = [
      {
        id: 'pivot-1',
        name: 'SummaryPivot',
        range: parseRangeAddress('D2:E3'),
        sourceRange: parseRangeAddress('A2:B3'),
        cacheId: 1,
        preservationStatus: 'safe',
      },
    ]
    session.deleteRows(sheet.id, 2, 2)
    expect(sheet.tables).toHaveLength(1)
    expect(sheet.tables[0].rangeStatus).toBe('unsafe')
    expect(sheet.pivots).toHaveLength(1)
    expect(sheet.pivots[0]).toMatchObject({
      preservationStatus: 'unsafe',
      rangeStatus: 'unsafe',
      refreshRequired: true,
    })
    expect(session.undo()).toBe(true)
    expect(sheet.tables[0].range).toEqual(parseRangeAddress('A2:B3'))
    expect(sheet.tables[0].rangeStatus).toBeUndefined()
    expect(sheet.pivots[0].preservationStatus).toBe('safe')
  })

  it('emits dirty regions and resets dirty state and history on replacement', () => {
    const { session, workbook } = freshSession()
    const events: Array<{ kind: string; dirty: boolean; dirtyChanged: boolean; regions: unknown[] }> = []
    session.subscribe((event) =>
      events.push({
        kind: event.kind,
        dirty: event.isDirty,
        dirtyChanged: event.dirtyChanged,
        regions: event.dirtyRegions,
      }),
    )
    session.setCell(workbook.activeSheetId, 'B2', { kind: 'boolean', value: true })
    expect(events[0]).toMatchObject({
      kind: 'change',
      dirty: true,
      dirtyChanged: true,
      regions: [{ kind: 'cells', range: { start: { row: 2, column: 2 }, end: { row: 2, column: 2 } } }],
    })
    session.setCells(workbook.activeSheetId, [
      { address: 'A1', value: { kind: 'string', value: 'top' } },
      { address: 'XFD1048576', value: { kind: 'string', value: 'bottom' } },
    ])
    expect(events[1].regions).toHaveLength(2)
    session.markClean()
    expect(session.isDirty).toBe(false)
    session.setCell(workbook.activeSheetId, 'C3', { kind: 'string', value: 'x' })
    expect(session.undo()).toBe(true)
    expect(session.isDirty).toBe(false)
    session.setCell(workbook.activeSheetId, 'D4', { kind: 'number', value: 9 })
    session.replaceWorkbook(createWorkbook({ firstSheetName: 'Opened', idFactory: () => 'opened-sheet' }))
    expect(session.historyState).toMatchObject({ canUndo: false, canRedo: false, undoDepth: 0, redoDepth: 0 })
    expect(session.isDirty).toBe(false)
    expect(session.undo()).toBe(false)
    expect(events.at(-1)).toMatchObject({ kind: 'replace', dirty: false })
  })

  it('enforces a bounded history budget before applying an oversized command', () => {
    const workbook = createWorkbook({ idFactory: () => 'sheet-1' })
    const session = new WorkbookSession(workbook, { historyBudgetBytes: 32 })
    expect(() =>
      session.setCell('sheet-1', 'A1', { kind: 'string', value: 'a value too large for the history budget' }),
    ).toThrow(/history/)
    expect(session.getCell('sheet-1', 'A1')).toBeUndefined()
  })

  it('evicts the oldest reversible commands when the bounded history fills', () => {
    const sample = new WorkbookSession(createWorkbook({ idFactory: () => 'sheet-1' }))
    sample.setCell('sheet-1', 'A1', { kind: 'string', value: 'x' })
    const oneCommandBytes = sample.historyState.estimatedBytes
    const workbook = createWorkbook({ idFactory: () => 'sheet-1' })
    const budget = oneCommandBytes + 400
    const session = new WorkbookSession(workbook, { historyBudgetBytes: budget })
    session.setCell('sheet-1', 'A1', { kind: 'string', value: 'x' })
    session.setCell('sheet-1', 'B1', { kind: 'string', value: 'x' })
    expect(session.historyState.undoDepth).toBe(1)
    expect(session.historyState.estimatedBytes).toBeLessThanOrEqual(budget)
    expect(session.undo()).toBe(true)
    expect(session.getCell('sheet-1', 'A1')?.value).toEqual({ kind: 'string', value: 'x' })
    expect(session.getCell('sheet-1', 'B1')).toBeUndefined()
  })
})

describe('Grid Excel date serials', () => {
  it('models the 1900 leap-year compatibility day and the 1904 epoch', () => {
    expect(serialToDateParts(59, '1900')).toMatchObject({ year: 1900, month: 2, day: 28, fictitious1900LeapDay: false })
    expect(serialToDateParts(60, '1900')).toMatchObject({ year: 1900, month: 2, day: 29, fictitious1900LeapDay: true })
    expect(serialToDateParts(60.5, '1900')).toMatchObject({
      fictitious1900LeapDay: true,
      millisecondsOfDay: 43_200_000,
    })
    expect(serialToDateParts(61, '1900')).toMatchObject({ year: 1900, month: 3, day: 1, fictitious1900LeapDay: false })
    expect(serialToDateParts(0, '1904')).toMatchObject({ year: 1904, month: 1, day: 1 })
    expect(serialToDateParts(1, '1904')).toMatchObject({ year: 1904, month: 1, day: 2 })
    expect(dateToSerial(new Date(Date.UTC(1900, 2, 1)), '1900')).toBe(61)
    expect(dateToSerial(new Date(Date.UTC(1904, 0, 1)), '1904')).toBe(0)
    expect(() => serialToDateParts(-1, '1900')).toThrow(RangeError)
  })
})
