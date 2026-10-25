import { describe, expect, it } from 'vitest'
import { createWorkbook, WorkbookSession } from './index'
import { parseRangeAddress } from './address'
import type { WorkbookAction } from './commands'
import { exportXlsxWorkbook } from '../xlsx/export'
import { parseXlsxWorkbook } from '../xlsx/import'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { filteredRows, visibleRow } from './filter'
import { preservationFixture, tableAndNoteFixture } from '../xlsx/fixtures/safety-corpus'

function fixture() {
  const workbook = createWorkbook()
  const sheet = workbook.sheetsById.get(workbook.activeSheetId)!
  const session = new WorkbookSession(workbook)
  session.setCells(
    sheet.id,
    ['Name\tTeam', 'Anna\tA', 'Bob\tB', 'Anna\tB', '\tA'].flatMap((line, i) =>
      line
        .split('\t')
        .map((value, j) => ({ address: `${j ? 'B' : 'A'}${i + 1}`, value: { kind: 'string' as const, value } })),
    ),
  )
  session.markSaved(session.createSaveCheckpoint())
  return { workbook, sheet, session }
}
const range = parseRangeAddress('A1:B5')
function apply(session: WorkbookSession, criteria: Array<{ column: number; values: string[]; blank: boolean }>) {
  return session.execute({
    type: 'set-auto-filter',
    sheetId: session.workbook.activeSheetId,
    range,
    criteria,
  } as WorkbookAction)
}
const hidden = (sheet: ReturnType<typeof fixture>['sheet']) =>
  [...sheet.rowMetadata]
    .filter(([, m]) => m.hidden || (m as { filterHidden?: boolean }).filterHidden)
    .map(([r]) => r)
    .sort()

describe('PP05 basic AutoFilter', () => {
  it('filters a single column without changing any values/styles and preserves the header', () => {
    const { session, sheet } = fixture()
    const cells = structuredClone(sheet.cells)
    apply(session, [{ column: 1, values: ['Anna'], blank: false }])
    expect(hidden(sheet)).toEqual([3, 5])
    expect(sheet.cells).toEqual(cells)
  })
  it('refuses numeric date-formatted cells before a filter can create an unsaveable date criterion', () => {
    const { session, workbook, sheet } = fixture()
    sheet.cells.set('A3', { value: { kind: 'number', value: 45000 }, style: { numberFormat: 'yyyy-mm-dd' } })
    const before = structuredClone(workbook)
    expect(() => apply(session, [{ column: 1, values: ['45000'], blank: false }])).toThrow()
    expect(workbook).toEqual(before)
  })
  it('ORs accepted values, ANDs columns and distinguishes blanks', () => {
    const { session, sheet } = fixture()
    apply(session, [
      { column: 1, values: ['Anna', 'Bob'], blank: true },
      { column: 2, values: ['A'], blank: false },
    ])
    expect(hidden(sheet)).toEqual([3, 4])
    apply(session, [{ column: 1, values: ['Anna', 'Bob'], blank: false }])
    expect(hidden(sheet)).toEqual([5])
    apply(session, [{ column: 1, values: [], blank: true }])
    expect(hidden(sheet)).toEqual([2, 3, 4])
  })
  it('skips manual/filter hidden rows in both directions, including zero-result bodies', () => {
    const { session, sheet } = fixture()
    session.setRowMetadata(sheet.id, 2, { hidden: true })
    apply(session, [{ column: 1, values: ['Anna'], blank: false }])
    expect(visibleRow(sheet, 2, 1)).toBe(4)
    expect(visibleRow(sheet, 3, -1)).toBe(1)
    apply(session, [{ column: 1, values: [], blank: false }])
    expect(visibleRow(sheet, 2, 1)).toBe(6)
    expect(visibleRow(sheet, 5, -1)).toBe(1)
  })
  it('updates filter visibility with literal edits, refuses unsupported edits and protects manual hiding', () => {
    const { session, sheet } = fixture()
    apply(session, [{ column: 1, values: ['Anna'], blank: false }])
    session.setCells(sheet.id, [{ address: 'A3', value: { kind: 'string', value: 'Anna' } }])
    expect(hidden(sheet)).toEqual([5])
    session.undo()
    expect(hidden(sheet)).toEqual([3, 5])
    session.setRowMetadata(sheet.id, 3, { hidden: true })
    apply(session, [])
    expect(hidden(sheet)).toEqual([3])
    expect(() => session.insertRows(sheet.id, 2, 1)).toThrow()
    expect(() => session.setRowMetadata(sheet.id, 1, { hidden: true })).toThrow()
  })
  it.each(
    [
      [{ column: 1, values: ['Anna', 'Anna'], blank: false }],
      [
        { column: 1, values: ['Anna'], blank: false },
        { column: 1, values: ['Bob'], blank: false },
      ],
      [{ column: 1, values: [''], blank: false }],
      [{ column: 0, values: [], blank: true }],
      [{ column: 1.5, values: [], blank: true }],
      [{ column: 1, values: ['\uffff'], blank: false }],
    ].map((criteria) => ({ criteria })),
  )('rejects invalid criteria %j atomically', ({ criteria }) => {
    const { session, workbook } = fixture()
    const before = structuredClone(workbook)
    const history = session.historyState
    expect(() => apply(session, criteria)).toThrow()
    expect(workbook).toEqual(before)
    expect(session.historyState).toEqual(history)
    expect(session.isDirty).toBe(false)
  })
  it('pure planning (cancel) never mutates and history budget failure stays atomic', () => {
    const { workbook, sheet } = fixture()
    const before = structuredClone(workbook)
    filteredRows(workbook, sheet, range, [{ column: 1, values: ['Anna'], blank: false }])
    expect(workbook).toEqual(before)
    expect(() => apply(new WorkbookSession(workbook, { historyBudgetBytes: 1 }), [])).toThrow(/history/)
    expect(workbook).toEqual(before)
  })
  it.each([preservationFixture, tableAndNoteFixture])(
    'retains unknown OOXML/native-table safety refusals',
    async (fixtureBytes) => {
      const workbook = (await parseXlsxWorkbook('opaque.xlsx', fixtureBytes())).workbook!
      const before = structuredClone(workbook)
      expect(() => apply(new WorkbookSession(workbook), [])).toThrow()
      expect(structuredClone(workbook)).toEqual(before)
    },
  )
  it.each(['A1:B1', 'A1:B10000'])('refuses unsupported range %s before mutation', (address) => {
    const { session, workbook } = fixture()
    const before = structuredClone(workbook)
    expect(() =>
      session.execute({
        type: 'set-auto-filter',
        sheetId: workbook.activeSheetId,
        range: parseRangeAddress(address),
        criteria: [],
      }),
    ).toThrow()
    expect(workbook).toEqual(before)
  })
  it('zero results, clear, undo/redo and checkpoints retain manual row hiding', () => {
    const { session, sheet } = fixture()
    session.setRowMetadata(sheet.id, 2, { hidden: true, height: 24 })
    session.markSaved(session.createSaveCheckpoint())
    const before = structuredClone(sheet)
    apply(session, [{ column: 1, values: [], blank: false }])
    expect(hidden(sheet)).toEqual([2, 3, 4, 5])
    session.undo()
    expect(sheet).toEqual(before)
    expect(session.isDirty).toBe(false)
    session.redo()
    apply(session, [])
    expect(hidden(sheet)).toEqual([2])
    expect(sheet.rowMetadata.get(2)).toEqual({ hidden: true, height: 24 })
    session.undo()
    expect(hidden(sheet)).toEqual([2, 3, 4, 5])
  })
  it('refuses invalid criteria atomically', () => {
    const { workbook, session } = fixture()
    const before = structuredClone(workbook)
    expect(() => apply(session, [{ column: 3, values: ['x'], blank: false }])).toThrow()
    expect(workbook).toEqual(before)
  })
  it('writes native criteria and effective visibility, then reopens and clears without exposing manual rows', async () => {
    const { session, workbook, sheet } = fixture()
    session.setRowMetadata(sheet.id, 2, { hidden: true })
    apply(session, [
      { column: 1, values: ['Bob'], blank: false },
      { column: 2, values: ['B'], blank: false },
    ])
    const saved = await exportXlsxWorkbook(workbook, 'filtered.xlsx')
    expect(saved.report.canSave, JSON.stringify(saved.report)).toBe(true)
    const parts = unzipSync(saved.bytes!)
    const xml = strFromU8(parts['xl/worksheets/sheet1.xml'])
    expect(xml).toContain('<autoFilter ref="A1:B5">')
    expect(xml).toContain('<filterColumn colId="0"><filters><filter val="Bob"')
    expect(xml).toContain('<filterColumn colId="1"><filters><filter val="B"')
    expect(xml).toMatch(/<row[^>]*r="2"[^>]*hidden="1"/)
    expect(strFromU8(parts['xl/_rels/workbook.xml.rels'])).toContain('worksheets/sheet1.xml')
    expect(strFromU8(parts['[Content_Types].xml'])).toContain('/xl/worksheets/sheet1.xml')
    // Explicit RGB supported fixture; theme/indexed styles stay protected.
    parts['xl/styles.xml'] = strToU8(
      strFromU8(parts['xl/styles.xml'])
        .replace(/theme="1"/g, 'rgb="FF000000"')
        .replace(/indexed="64"/g, 'rgb="FF000000"'),
    )
    const reopened = (await parseXlsxWorkbook('filtered.xlsx', zipSync(parts))).workbook!
    const next = new WorkbookSession(reopened)
    const nextSheet = reopened.sheetsById.get(reopened.activeSheetId)!
    expect(nextSheet.autoFilter?.criteria).toEqual(sheet.autoFilter?.criteria)
    expect(hidden(nextSheet)).toEqual([2, 4, 5])
    for (const [address, cell] of sheet.cells) {
      expect(nextSheet.cells.get(address)?.value).toEqual(cell.value)
      expect(nextSheet.cells.get(address)?.style).toEqual(cell.style ?? { fill: { pattern: 'none' } })
    }
    // Patch a real imported package as well as creating a new one.
    apply(next, [])
    expect(hidden(nextSheet)).toEqual([2])
    const cleared = await exportXlsxWorkbook(reopened, 'cleared.xlsx')
    expect(cleared.report.canSave).toBe(true)
    const final = (await parseXlsxWorkbook('cleared.xlsx', cleared.bytes!)).workbook!
    expect(hidden(final.sheetsById.get(final.activeSheetId)!)).toEqual([2])
  })
  it('saves manual rows which match the filter and fully empty filtered rows, then permits repeated changes', async () => {
    const { session, workbook, sheet } = fixture()
    session.setRowMetadata(sheet.id, 2, { hidden: true })
    session.setCells(sheet.id, [
      { address: 'A5', value: { kind: 'blank' } },
      { address: 'B5', value: { kind: 'blank' } },
    ])
    apply(session, [{ column: 1, values: ['Anna'], blank: false }])
    const saved = await exportXlsxWorkbook(workbook, 'matching.xlsx')
    expect(saved.report.canSave).toBe(true)
    const parts = unzipSync(saved.bytes!)
    expect(strFromU8(parts['xl/worksheets/sheet1.xml'])).toMatch(/<row[^>]*r="5"[^>]*hidden="1"/)
    parts['xl/styles.xml'] = strToU8(
      strFromU8(parts['xl/styles.xml'])
        .replace(/theme="1"/g, 'rgb="FF000000"')
        .replace(/indexed="64"/g, 'rgb="FF000000"'),
    )
    const imported = (await parseXlsxWorkbook('matching.xlsx', zipSync(parts))).workbook!
    const next = new WorkbookSession(imported)
    apply(next, [{ column: 1, values: ['Bob'], blank: true }])
    apply(next, [])
    expect(hidden(imported.sheetsById.get(imported.activeSheetId)!)).toEqual([2])
    const result = await exportXlsxWorkbook(imported, 'cleared.xlsx')
    expect(result.report.canSave).toBe(true)
  })
  it.each(['date', 'error', 'formula'] as const)('refuses %s filter values before mutation', (kind) => {
    const { session, workbook, sheet } = fixture()
    sheet.cells.set('A3', {
      value:
        kind === 'date'
          ? { kind, serial: 45000, numberFormat: 'yyyy-mm-dd' }
          : kind === 'error'
            ? { kind, code: '#N/A' }
            : {
                kind,
                formula: {
                  source: '=1',
                  canonicalExpression: '=1',
                  ast: null,
                  cachedResult: { kind: 'number', value: 1 },
                  calculationStatus: 'fresh',
                },
              },
    })
    const before = structuredClone(workbook)
    expect(() => apply(session, [])).toThrow()
    expect(workbook).toEqual(before)
  })
  it.each([
    '<filterColumn colId="0"><customFilters><customFilter operator="equal" val="Anna"/></customFilters></filterColumn>',
    '<filterColumn colId="0"><filters><filter val="Anna"/></filters></filterColumn>',
    '</autoFilter><autoFilter ref="A1:B5">',
    '<filterColumn colId="0"><filters xmlns="urn:foreign" blank="1"/></filterColumn>',
  ])('refuses opaque or ambiguous imported filters without mutation: %s', async (definition) => {
    const { workbook } = fixture()
    const saved = await exportXlsxWorkbook(workbook, 'source.xlsx')
    const parts = unzipSync(saved.bytes!)
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      strFromU8(parts['xl/worksheets/sheet1.xml'])
        .replace('<row r="2"', '<row hidden="1" r="2"')
        .replace('</worksheet>', `<autoFilter ref="A1:B5">${definition}</autoFilter></worksheet>`),
    )
    const bytes = zipSync(parts)
    const imported = (await parseXlsxWorkbook('imported.xlsx', bytes)).workbook!
    expect(imported.sheetsById.get(imported.activeSheetId)!.autoFilter?.unsupported).toBe(true)
    const before = structuredClone(imported)
    expect(() => apply(new WorkbookSession(imported), [])).toThrow()
    expect(structuredClone(imported)).toEqual(before)
    const unchanged = await exportXlsxWorkbook(imported, 'unchanged.xlsx')
    expect(unchanged.bytes).toEqual(bytes)
  })
})
