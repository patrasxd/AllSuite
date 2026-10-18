import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  AddressError,
  WorkbookSession,
  createWorkbook,
  createOpaquePartDescriptor,
  dateToSerial,
  getCell,
  getSparseRange,
  parseRangeAddress,
  parseSheetQualifiedAddress,
  resolveDefinedName,
  serialToDateParts,
  type CellValue,
  type WorkbookChangeEvent,
} from './index'

function setup() {
  const workbook = createWorkbook({ firstSheetName: 'Data' })
  const session = new WorkbookSession(workbook)
  const sheetId = workbook.activeSheetId
  const sheet = workbook.sheetsById.get(sheetId)!
  return { workbook, session, sheetId, sheet }
}

describe('workbook core contracts', () => {
  it('marks only the saved revision clean and ignores saves from replaced workbooks', () => {
    const { session, sheetId } = setup()
    session.setCell(sheetId, 'A1', { kind: 'number', value: 1 })
    const checkpoint = session.createSaveCheckpoint()
    session.setCell(sheetId, 'A1', { kind: 'number', value: 2 })
    expect(session.markSaved(checkpoint)).toBe(false)
    expect(session.isDirty).toBe(true)
    session.undo()
    expect(session.isDirty).toBe(false)
    session.redo()
    expect(session.isDirty).toBe(true)
    session.replaceWorkbook(createWorkbook())
    session.setCell(session.workbook.activeSheetId, 'A1', { kind: 'number', value: 3 })
    expect(session.markSaved(checkpoint)).toBe(false)
    expect(session.isDirty).toBe(true)
  })

  it('has no imports outside the framework-independent core', () => {
    const directory = resolve('packages/apps/grid/src/engine/workbook')
    for (const file of readdirSync(directory).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))) {
      const source = readFileSync(resolve(directory, file), 'utf8')
      const imports = [...source.matchAll(/(?:from\s+|import\s*\()(['"])([^'"]+)\1/g)]
      for (const match of imports) expect(match[2], file).toMatch(/^\.\/[^/]+$/)
      expect(source, file).not.toMatch(/\b(?:localStorage|sessionStorage|indexedDB|fetch)\b/)
    }
  })

  it('rejects invalid object coordinates, ranges, quoted references and sheet names', () => {
    const { session, sheetId, sheet } = setup()
    for (const row of [0, -1, 1.5, NaN, Infinity, 1_048_577]) {
      expect(() => getCell(sheet, { row, column: 1 })).toThrow(AddressError)
      expect(() => session.setCell(sheetId, { row, column: 1 }, { kind: 'boolean', value: true })).toThrow()
    }
    expect(() => getSparseRange(sheet, { start: { row: 2, column: 1 }, end: { row: 1, column: 1 } })).toThrow()
    expect(() => parseSheetQualifiedAddress("'Bad''Quote'Name'!A1")).toThrow(AddressError)
    for (const name of ['   ', 'bad\u0000name', 'bad\nname', 'bad:name', "'edge"]) {
      expect(() => session.createSheet(name)).toThrow()
    }
    expect(session.isDirty).toBe(false)
    expect(sheet.cells.size).toBe(0)
  })

  it('stores every value type separately from display and isolates read and input snapshots', () => {
    const { session, sheetId } = setup()
    const values: CellValue[] = [
      { kind: 'number', value: 3.5 },
      { kind: 'string', value: '003.50' },
      { kind: 'boolean', value: false },
      { kind: 'error', code: '#REF!' },
      { kind: 'date', serial: 60.5, numberFormat: 'yyyy-mm-dd hh:mm' },
      {
        kind: 'formula',
        formula: {
          source: '=A1',
          canonicalExpression: '=A1',
          ast: null,
          cachedResult: { kind: 'number', value: 3.5 },
          calculationStatus: 'unsupported',
        },
      },
    ]
    session.setCells(
      sheetId,
      values.map((value, index) => ({ address: `A${index + 1}`, value })),
    )
    values[0] = { kind: 'number', value: 99 }
    const read = session.getCell(sheetId, 'A1')!
    read.value = { kind: 'string', value: 'changed externally' }
    expect(session.getCell(sheetId, 'A1')?.value).toEqual({ kind: 'number', value: 3.5 })
    expect(session.getCell(sheetId, 'A2')?.value).toEqual({ kind: 'string', value: '003.50' })
    expect(session.getCell(sheetId, 'A5')?.value).toEqual(values[4])
    expect(session.getCell(sheetId, 'A6')?.value).toMatchObject({
      kind: 'formula',
      formula: { calculationStatus: 'stale', cachedResult: { kind: 'number', value: 3.5 } },
    })
    expect(session.historyState.undoDepth).toBe(1)
  })

  it('makes scoped names reversible and resolves local names before global names across sheets', () => {
    const { session, workbook, sheetId } = setup()
    const other = session.createSheet('Other')
    session.addDefinedName({ name: 'Total', targetSheetId: sheetId, range: parseRangeAddress('A1:A2') })
    session.addDefinedName({
      name: 'Total',
      scopeSheetId: other,
      targetSheetId: sheetId,
      range: parseRangeAddress('B1:B2'),
    })
    expect(resolveDefinedName(workbook, 'TOTAL', other)?.range).toEqual(parseRangeAddress('B1:B2'))
    expect(resolveDefinedName(workbook, 'total', sheetId)?.range).toEqual(parseRangeAddress('A1:A2'))
    session.insertRows(sheetId, 1, 2)
    expect(resolveDefinedName(workbook, 'total', other)?.range).toEqual(parseRangeAddress('B3:B4'))
    session.undo()
    expect(resolveDefinedName(workbook, 'total', other)?.range).toEqual(parseRangeAddress('B1:B2'))
    session.deleteDefinedName('TOTAL', other)
    expect(resolveDefinedName(workbook, 'total', other)?.range).toEqual(parseRangeAddress('A1:A2'))
    session.undo()
    expect(resolveDefinedName(workbook, 'total', other)?.scopeSheetId).toBe(other)
    expect(() => session.addDefinedName({ name: 'BadTarget', targetSheetId: 'missing' })).toThrow()
    expect(() => session.addDefinedName({ name: 'R' })).toThrow()
  })

  it('retains unsafe range descriptors and removes collapsed single-cell merges reversibly', () => {
    const { session, sheet, sheetId, workbook } = setup()
    sheet.validations.push({ id: 'v', type: 'whole', range: parseRangeAddress('D1:D3'), rangeStatus: 'unsafe' })
    session.addDefinedName({ name: 'Removed', targetSheetId: sheetId, range: parseRangeAddress('A2:A3') })
    session.merge(sheetId, 'A1:A2')
    session.deleteRows(sheetId, 2, 2)
    expect(sheet.merges).toEqual([])
    expect(sheet.validations[0].rangeStatus).toBe('unsafe')
    expect(resolveDefinedName(workbook, 'Removed')).toMatchObject({ rangeStatus: 'unsafe', stale: true })
    session.undo()
    expect(sheet.merges).toEqual([parseRangeAddress('A1:A2')])
    expect(resolveDefinedName(workbook, 'Removed')?.rangeStatus).toBeUndefined()
  })

  it('rejects structural overflow atomically and keeps bulk formatting as one undo step', () => {
    const { session, sheetId, sheet } = setup()
    session.setCell(sheetId, 'XFD1048576', { kind: 'number', value: 1 })
    session.markClean()
    const history = session.historyState
    expect(() => session.insertRows(sheetId, 1)).toThrow()
    expect(() => session.insertColumns(sheetId, 1)).toThrow()
    expect(session.historyState).toEqual(history)
    expect(session.isDirty).toBe(false)
    session.formatCells(
      sheetId,
      ['A1', 'B1'].map((address) => ({ address, style: { numberFormat: '0.00' } })),
    )
    expect(sheet.cells.size).toBe(3)
    session.undo()
    expect(sheet.cells.size).toBe(1)
    expect(session.isDirty).toBe(false)
    expect(() =>
      session.formatCells(sheetId, [
        { address: 'A1', style: null },
        { address: '$A$1', style: {} },
      ]),
    ).toThrow()
  })

  it('emits only changed regions, preserves unrelated cell identity, and discards redo on a new branch', () => {
    const { session, sheetId, sheet } = setup()
    session.setCell(sheetId, 'B2', { kind: 'string', value: 'untouched' })
    const unchanged = sheet.cells.get('B2')
    const events: WorkbookChangeEvent[] = []
    const unsubscribe = session.subscribe((event) => events.push(event))
    session.setCell(sheetId, 'A1', { kind: 'number', value: 1 })
    expect(events).toHaveLength(1)
    expect(events[0].dirtyRegions).toEqual([
      { kind: 'cells', sheetId, range: { start: { row: 1, column: 1 }, end: { row: 1, column: 1 } } },
    ])
    expect(sheet.cells.get('B2')).toBe(unchanged)
    expect(session.setCell(sheetId, 'A1', { kind: 'number', value: 1 })).toBe(false)
    expect(events).toHaveLength(1)
    session.undo()
    session.setCell(sheetId, 'C1', { kind: 'number', value: 2 })
    expect(session.redo()).toBe(false)
    unsubscribe()
  })

  it('copies local names to a duplicate and restores names and targets when deleting is undone', () => {
    const { session, workbook, sheetId } = setup()
    session.addDefinedName({
      name: 'Local',
      scopeSheetId: sheetId,
      targetSheetId: sheetId,
      range: parseRangeAddress('A1'),
    })
    session.addDefinedName({ name: 'Global', targetSheetId: sheetId, range: parseRangeAddress('A1') })
    const copy = session.duplicateSheet(sheetId, 'Copy')
    expect(resolveDefinedName(workbook, 'Local', copy)?.targetSheetId).toBe(copy)
    session.deleteSheet(sheetId)
    expect(workbook.definedNames.some((name) => name.scopeSheetId === sheetId)).toBe(false)
    expect(resolveDefinedName(workbook, 'Global')?.rangeStatus).toBe('unsafe')
    session.undo()
    expect(resolveDefinedName(workbook, 'Local', sheetId)?.targetSheetId).toBe(sheetId)
    expect(resolveDefinedName(workbook, 'Global')?.rangeStatus).toBeUndefined()
  })

  it('handles both date epochs, fractional UTC days and invalid serials without producing NaN dates', () => {
    expect(serialToDateParts(0, '1900')).toMatchObject({ year: 1899, month: 12, day: 31 })
    for (const system of ['1900', '1904'] as const) {
      const date = new Date(Date.UTC(2024, 1, 29, 12))
      expect(serialToDateParts(dateToSerial(date, system), system)).toMatchObject({
        year: 2024,
        month: 2,
        day: 29,
        millisecondsOfDay: 43_200_000,
      })
      for (const serial of [NaN, Infinity, Number.MAX_VALUE, -1])
        expect(() => serialToDateParts(serial, system)).toThrow(RangeError)
      expect(() => dateToSerial(new Date(NaN), system)).toThrow(RangeError)
    }
  })

  it('retains opaque bytes by reference in history and releases the old session on replacement', () => {
    const { session, workbook, sheetId } = setup()
    const archive = new Uint8Array(1_000_000)
    archive[0] = 80
    const part = createOpaquePartDescriptor({ partName: 'customXml/data.xml', originalBytes: new Uint8Array([1, 2]) })
    workbook.preservation = { originalArchiveBytes: archive, parts: [part] }
    session.setCell(sheetId, 'A1', { kind: 'number', value: 1 })
    expect(workbook.preservation.originalArchiveBytes).toBe(archive)
    expect(workbook.preservation.parts[0].originalBytes).toBe(part.originalBytes)
    expect(workbook.preservation.parts[0].status).toBe('unsafe')
    expect(session.historyState.estimatedBytes).toBeLessThan(10_000)
    session.undo()
    expect(workbook.preservation.parts[0].status).toBe('safe')
    expect(session.historyState.canRedo).toBe(true)
    session.replaceWorkbook(createWorkbook())
    expect(session.workbook.preservation).toBeUndefined()
    expect(session.historyState).toMatchObject({ undoDepth: 0, redoDepth: 0, estimatedBytes: 0 })
    expect(session.isDirty).toBe(false)
  })
})
