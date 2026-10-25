import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { WorkbookSession, createWorkbook, parseRangeAddress } from '../workbook'
import { inferCellValue } from './cell-input'
import { copyValues, parseValuesTsv, pasteValues, valuesToTsv } from './clipboard'
import { exportXlsxWorkbook } from '../xlsx/export'
import { parseXlsxWorkbook } from '../xlsx/import'

function setup() {
  const session = new WorkbookSession(createWorkbook())
  return { session, id: session.workbook.activeSheetId }
}

describe('PP01 values clipboard', () => {
  it('retains single-column trailing blank shape and typed strings independently from TSV', () => {
    const { session, id } = setup()
    expect(parseValuesTsv(valuesToTsv([[{ kind: 'number', value: 1 }], [{ kind: 'blank' }]]))).toEqual([
      [{ kind: 'number', value: 1 }],
      [{ kind: 'blank' }],
    ])
    session.setCells(id, [
      { address: 'A1', value: { kind: 'string', value: '12' } },
      { address: 'B1', value: { kind: 'string', value: 'TRUE' } },
      { address: 'C1', value: { kind: 'date', serial: 45000, numberFormat: 'yyyy-mm-dd' } },
      { address: 'D1', value: { kind: 'error', code: '#N/A' } },
    ])
    const block = copyValues(session, id, [parseRangeAddress('A1:D1')])
    pasteValues(session, id, { row: 2, column: 1 }, block)
    for (const column of ['A', 'B', 'C', 'D'])
      expect(session.getCell(id, `${column}2`)?.value).toEqual(session.getCell(id, `${column}1`)?.value)
    expect(parseValuesTsv(valuesToTsv(block))[0].map((cell) => cell.kind)).toEqual([
      'number',
      'boolean',
      'number',
      'string',
    ])
  })

  it('rejects a command exceeding the history budget without allocating a partial edit', () => {
    const session = new WorkbookSession(createWorkbook(), { historyBudgetBytes: 1 })
    const id = session.workbook.activeSheetId
    const before = structuredClone(session.workbook)
    expect(() => pasteValues(session, id, { row: 1, column: 1 }, parseValuesTsv('a\tb'))).toThrow()
    expect(session.workbook).toEqual(before)
    expect(session.historyState.undoDepth).toBe(0)
    expect(session.isDirty).toBe(false)
  })

  it('preserves destination styles and neighbors, and copies neither source style nor formulas', () => {
    const { session, id } = setup()
    session.setCell(id, 'A1', { kind: 'number', value: 12 })
    session.formatCells(id, [
      { address: 'A1', style: { font: { bold: true } } },
      { address: 'D1', style: { fill: { color: '#ff0000' } } },
    ])
    session.setCell(id, 'F1', { kind: 'string', value: 'neighbor' })
    const before = structuredClone(session.workbook.sheetsById.get(id)!.cells)
    pasteValues(session, id, { row: 1, column: 4 }, copyValues(session, id, [parseRangeAddress('A1:B1')]))
    expect(session.getCell(id, 'D1')).toEqual({
      value: { kind: 'number', value: 12 },
      style: { fill: { color: '#ff0000' } },
    })
    expect(session.getCell(id, 'A1')).toEqual(before.get('A1'))
    expect(session.getCell(id, 'F1')).toEqual(before.get('F1'))
  })

  it('refuses unsupported destination formulas and native table headers without changing history or dirty state', () => {
    const { session, id } = setup()
    session.setCell(id, 'D1', inferCellValue('=UNKNOWN()', 'en', '1900'))
    session.applyCalculationResults([{ sheetId: id, address: 'D1', calculationStatus: 'unsupported' }])
    session.markClean()
    const before = structuredClone(session.workbook)
    const history = session.historyState
    expect(() => pasteValues(session, id, { row: 1, column: 4 }, parseValuesTsv('replace'))).toThrow()
    expect(session.workbook).toEqual(before)
    expect(session.historyState).toEqual(history)
    expect(session.isDirty).toBe(false)
    session.workbook.sheetsById.get(id)!.tables.push({
      id: 'table',
      name: 'Table1',
      range: parseRangeAddress('G1:H3'),
      columns: [
        { id: '1', name: 'Header' },
        { id: '2', name: 'Other' },
      ],
    })
    const withTable = structuredClone(session.workbook)
    expect(() => pasteValues(session, id, { row: 1, column: 7 }, parseValuesTsv('replace'))).toThrow()
    expect(session.workbook).toEqual(withTable)
    expect(session.historyState).toEqual(history)
  })
  it('roundtrips quoting, CRLF, tabs, Unicode, empty cells and literal formula-like text', () => {
    const text = '00123\t"Zażółć\t""tekst""\r\nnext"\r\n=1+1\t\r\n'
    const rows = parseValuesTsv(text)
    expect(rows).toEqual([
      [
        { kind: 'string', value: '00123' },
        { kind: 'string', value: 'Zażółć\t"tekst"\r\nnext' },
      ],
      [{ kind: 'string', value: '=1+1' }, { kind: 'blank' }],
    ])
    expect(parseValuesTsv(valuesToTsv(rows))).toEqual(rows)
    expect(parseValuesTsv('12\tTRUE\tfalse\t1.5')[0]).toEqual([
      { kind: 'number', value: 12 },
      { kind: 'boolean', value: true },
      { kind: 'boolean', value: false },
      { kind: 'number', value: 1.5 },
    ])
  })

  it.each(['a\tb\nc', '"unclosed', 'a"b', '"a"x', 'x\u0000', 'a'.repeat(1_000_001), '\t'.repeat(10_000)])(
    'refuses malformed or excessive TSV case %#',
    (text) => expect(() => parseValuesTsv(text)).toThrow(),
  )

  it('copies typed values, blank and fresh scalar results; pastes atomically with one undo', () => {
    const { session, id } = setup()
    session.setCells(id, [
      { address: 'A1', value: { kind: 'string', value: '00123' } },
      { address: 'B1', value: { kind: 'boolean', value: true } },
      { address: 'A2', value: inferCellValue('=2+3', 'en', '1900') },
      { address: 'B2', value: { kind: 'string', value: '=literal' } },
      { address: 'A3', value: { kind: 'number', value: 7 } },
      { address: 'E3', value: { kind: 'string', value: 'clear me' } },
    ])
    session.applyCalculationResults([
      { sheetId: id, address: 'A2', calculationStatus: 'fresh', result: { kind: 'number', value: 5 } },
    ])
    session.markClean()
    const values = copyValues(session, id, [parseRangeAddress('A1:B3')])
    expect(values[1][0]).toEqual({ kind: 'number', value: 5 })
    const depth = session.historyState.undoDepth
    expect(pasteValues(session, id, { row: 1, column: 4 }, values)).toEqual({
      start: { row: 1, column: 4 },
      end: { row: 3, column: 5 },
    })
    expect(session.getCell(id, 'E3')).toBeUndefined()
    expect(session.getCell(id, 'E1')?.value).toEqual({ kind: 'boolean', value: true })
    expect(session.getCell(id, 'E2')?.value).toEqual({ kind: 'string', value: '=literal' })
    expect(session.historyState.undoDepth).toBe(depth + 1)
    expect(session.isDirty).toBe(true)
    session.undo()
    expect(session.isDirty).toBe(false)
    expect(session.getCell(id, 'E3')?.value).toEqual({ kind: 'string', value: 'clear me' })
    session.redo()
    expect(session.getCell(id, 'D2')?.value).toEqual({ kind: 'number', value: 5 })
  })

  it.each(['stale', 'unsupported', 'error'] as const)('refuses %s formula results without changes', (status) => {
    const { session, id } = setup()
    session.setCell(id, 'A1', inferCellValue('=2+3', 'en', '1900'))
    session.applyCalculationResults([
      { sheetId: id, address: 'A1', calculationStatus: status, result: { kind: 'number', value: 5 } },
    ])
    const before = structuredClone(session.workbook)
    const history = session.historyState
    expect(() => copyValues(session, id, [parseRangeAddress('A1')])).toThrow()
    expect(session.workbook).toEqual(before)
    expect(session.historyState).toEqual(history)
  })

  it('refuses disjoint, merged, unsafe and out-of-bounds ranges with zero mutation', () => {
    const { session, id } = setup()
    const values = parseValuesTsv('a\tb')
    session.merge(id, 'D1:E1')
    const before = structuredClone(session.workbook)
    const history = session.historyState
    expect(() => copyValues(session, id, [parseRangeAddress('A1'), parseRangeAddress('B2')])).toThrow()
    expect(() => copyValues(session, id, [parseRangeAddress('D1:E1')])).toThrow()
    expect(() => copyValues(session, id, [parseRangeAddress('A1:A10001')])).toThrow()
    expect(() => pasteValues(session, id, { row: 1, column: 4 }, values)).toThrow()
    expect(() => pasteValues(session, id, { row: 1, column: 16384 }, values)).toThrow()
    expect(session.workbook).toEqual(before)
    expect(session.historyState).toEqual(history)
    session.workbook.preservation = {
      parts: [{ partName: 'unsafe', status: 'unsafe', dependsOn: ['all'], unsafeReasons: ['unknown'] }],
    }
    const unsafe = structuredClone(session.workbook)
    expect(() => pasteValues(session, id, { row: 3, column: 4 }, values)).toThrow()
    expect(session.workbook).toEqual(unsafe)
  })

  it('saves a file-backed A1:B3 to D1:E3 copy and freshly reopens exact values and neighbors with no formulas at target', async () => {
    const { session, id } = setup()
    session.setCells(
      id,
      ['00123', 'TRUE', "'=literal", '7', 'Zażółć', ''].map((text, i) => ({
        address: `${i % 2 ? 'B' : 'A'}${Math.floor(i / 2) + 1}`,
        value: inferCellValue(text, 'en', '1900'),
      })),
    )
    session.setCell(id, 'F3', { kind: 'string', value: 'neighbor' })
    const original = await exportXlsxWorkbook(session.workbook, 'source.xlsx')
    const opened = await parseXlsxWorkbook('source.xlsx', original.bytes!)
    const file = new WorkbookSession(opened.workbook!)
    const sheet = file.workbook.activeSheetId
    const before = structuredClone(file.workbook.sheetsById.get(sheet)!.cells)
    pasteValues(file, sheet, { row: 1, column: 4 }, copyValues(file, sheet, [parseRangeAddress('A1:B3')]))
    const output = await exportXlsxWorkbook(file.workbook, 'copied.xlsx')
    expect(output.report.canSave).toBe(true)
    const xml = strFromU8(unzipSync(output.bytes!)['xl/worksheets/sheet1.xml'])
    expect(xml).toContain('=literal')
    expect(xml).not.toContain('<f>')
    const reopened = await parseXlsxWorkbook('copied.xlsx', output.bytes!)
    const result = new WorkbookSession(reopened.workbook!)
    const resultId = result.workbook.activeSheetId
    for (const [address, cell] of before) expect(result.getCell(resultId, address)).toEqual(cell)
    for (let row = 1; row <= 3; row++)
      for (const [source, target] of [
        ['A', 'D'],
        ['B', 'E'],
      ]) {
        expect(result.getCell(resultId, `${target}${row}`)?.value).toEqual(before.get(`${source}${row}`)?.value)
      }
  })
})
