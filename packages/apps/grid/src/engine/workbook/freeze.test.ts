import { describe, expect, it } from 'vitest'
import { createWorkbook, WorkbookSession } from './index'
import type { WorkbookAction } from './commands'
import { exportXlsxWorkbook } from '../xlsx/export'
import { parseXlsxWorkbook } from '../xlsx/import'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { parseRangeAddress } from './address'
import { frozenAxes } from './freeze'

function fixture() {
  const workbook = createWorkbook()
  const session = new WorkbookSession(workbook)
  const sheet = workbook.sheetsById.get(workbook.activeSheetId)!
  session.setCells(sheet.id, [{ address: 'A1', value: { kind: 'string', value: 'Header' } }])
  session.markSaved(session.createSaveCheckpoint())
  return { workbook, session, sheet }
}
function freeze(session: WorkbookSession, rows: boolean, columns: boolean) {
  return session.execute({
    type: 'set-frozen-panes',
    sheetId: session.workbook.activeSheetId,
    rows,
    columns,
  } as WorkbookAction)
}

describe('PP10 frozen pane commands and XLSX', () => {
  it('retains hidden/filter causes, sizes and values through toggles, history and fresh XLSX', async () => {
    const { workbook, session, sheet } = fixture()
    session.setCells(sheet.id, [
      { address: 'A2', value: { kind: 'string', value: 'keep' } },
      { address: 'A3', value: { kind: 'string', value: 'drop' } },
      { address: 'A4', value: { kind: 'string', value: 'keep' } },
    ])
    session.setRowMetadata(sheet.id, 2, { hidden: true, height: 42 })
    session.setColumnMetadata(sheet.id, 1, { width: 24 })
    session.execute({
      type: 'set-auto-filter',
      sheetId: sheet.id,
      range: parseRangeAddress('A1:A4'),
      criteria: [{ column: 1, values: ['keep'], blank: false }],
    })
    const rows = structuredClone(sheet.rowMetadata)
    const cells = structuredClone(sheet.cells)
    freeze(session, true, true)
    expect(frozenAxes(sheet)).toEqual({ rows: true, columns: true })
    expect(sheet.rowMetadata).toEqual(rows)
    const saved = await exportXlsxWorkbook(workbook, 'filter-freeze.xlsx')
    expect(saved.report.canSave).toBe(true)
    const parsed = (await parseXlsxWorkbook('filter-freeze.xlsx', saved.bytes!)).workbook!
    const fresh = new WorkbookSession(parsed)
    const reopened = parsed.sheetsById.get(parsed.activeSheetId)!
    expect(reopened.rowMetadata.get(2)).toMatchObject({ hidden: true, height: 42 })
    expect(reopened.rowMetadata.get(3)?.filterHidden).toBe(true)
    expect(reopened.columnMetadata.get(1)?.width).toBe(24)
    fresh.execute({ type: 'set-auto-filter', sheetId: reopened.id, range: reopened.autoFilter!.range, criteria: [] })
    expect(reopened.rowMetadata.get(2)?.hidden).toBe(true)
    expect(reopened.rowMetadata.get(3)?.filterHidden).toBeUndefined()
    freeze(session, false, false)
    session.undo()
    expect(frozenAxes(sheet)).toEqual({ rows: true, columns: true })
    expect(sheet.cells).toEqual(cells)
    expect(sheet.rowMetadata).toEqual(rows)
  })
  it('does not reveal a manually hidden first row and refuses history-budget overflow atomically', () => {
    const { workbook, sheet, session } = fixture()
    session.setRowMetadata(sheet.id, 1, { hidden: true })
    freeze(session, true, true)
    expect(sheet.rowMetadata.get(1)?.hidden).toBe(true)
    const before = structuredClone(workbook)
    const small = new WorkbookSession(workbook, { historyBudgetBytes: 1 })
    expect(() => freeze(small, false, false)).toThrow()
    expect(workbook).toEqual(before)
    expect(small.isDirty).toBe(false)
  })
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])('supports rows=%s columns=%s with exact history and cells', (rows, columns) => {
    const { session, sheet } = fixture()
    const cells = structuredClone(sheet.cells)
    if (!rows && !columns) freeze(session, true, true)
    const before = structuredClone(sheet.frozenPane)
    expect(freeze(session, rows, columns)).toBe(true)
    expect(sheet.frozenPane).toEqual(
      rows || columns
        ? {
            xSplit: Number(columns),
            ySplit: Number(rows),
            topLeftCell: `${columns ? 'B' : 'A'}${rows ? 2 : 1}`,
            activePane: columns ? (rows ? 'bottomRight' : 'topRight') : 'bottomLeft',
            state: 'frozen',
          }
        : undefined,
    )
    const after = structuredClone(sheet.frozenPane)
    expect(session.isDirty).toBe(true)
    session.undo()
    expect(sheet.frozenPane).toEqual(before)
    session.redo()
    expect(sheet.frozenPane).toEqual(after)
    expect(sheet.cells).toEqual(cells)
    expect(freeze(session, rows, columns)).toBe(false)
  })
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])('writes native XML and reopens rows=%s columns=%s in a fresh session', async (rows, columns) => {
    const { workbook, session, sheet } = fixture()
    freeze(session, true, true)
    freeze(session, rows, columns)
    const saved = await exportXlsxWorkbook(workbook, 'freeze.xlsx')
    expect(saved.report.canSave).toBe(true)
    const xml = strFromU8(unzipSync(saved.bytes!)['xl/worksheets/sheet1.xml'])
    if (rows || columns) {
      expect(xml).toContain('state="frozen"')
      expect(xml).toContain(`topLeftCell="${columns ? 'B' : 'A'}${rows ? 2 : 1}"`)
      expect(xml.includes('xSplit="1"')).toBe(columns)
      expect(xml.includes('ySplit="1"')).toBe(rows)
      expect(xml).toContain(`<selection pane="${sheet.frozenPane!.activePane}"`)
    } else expect(xml).not.toContain('<pane')
    const parsed = (await parseXlsxWorkbook('freeze.xlsx', saved.bytes!)).workbook!
    const fresh = new WorkbookSession(parsed)
    const reopened = parsed.sheetsById.get(parsed.activeSheetId)!
    expect(reopened.frozenPane).toEqual(sheet.frozenPane)
    expect(fresh.getCell(reopened.id, 'A1')?.value).toEqual({ kind: 'string', value: 'Header' })
    freeze(fresh, !rows, !columns)
    const second = await exportXlsxWorkbook(parsed, 'second.xlsx')
    expect(second.report.canSave).toBe(true)
    const again = (await parseXlsxWorkbook('second.xlsx', second.bytes!)).workbook!
    expect(again.sheetsById.get(again.activeSheetId)!.frozenPane).toEqual(reopened.frozenPane)
  })
  it.each([
    '<sheetView workbookViewId="0"><pane xSplit="2000" state="split" topLeftCell="C1"/></sheetView>',
    '<sheetView workbookViewId="0"><pane ySplit="2" state="frozen" topLeftCell="A3"/></sheetView>',
    '<sheetView workbookViewId="0"><pane ySplit="1" state="frozen" topLeftCell="A2"/><selection pane="bottomLeft" sqref="A2 B4" activeCell="A2"/></sheetView>',
    '<sheetView workbookViewId="0"/><sheetView workbookViewId="1"/>',
    '<sheetView workbookViewId="0" rightToLeft="1"/>',
    '<sheetView workbookViewId="0"><pane ySplit="1" state="frozenSplit" topLeftCell="A2"/></sheetView>',
    '<sheetView workbookViewId="0"><pane ySplit="1" state="frozen" topLeftCell="A2" vendor="unknown"/></sheetView>',
    '<sheetView workbookViewId="0"><selection activeCell="B2" sqref="A1:C4"/></sheetView>',
    '<sheetView workbookViewId="0"><pane xSplit="invalid" ySplit="1" state="frozen" topLeftCell="A2"/></sheetView>',
    '<sheetView workbookViewId="0"><pane ySplit="1" state="frozen" topLeftCell="A2"/><pane xSplit="1" state="frozen" topLeftCell="B1"/></sheetView>',
    '<sheetView workbookViewId="0"><pane xmlns="urn:vendor" ySplit="1" state="frozen" topLeftCell="A2"/></sheetView>',
    '<sheetView workbookViewId="0"><pane ySplit="1" state="frozen" topLeftCell="A2"/><selection pane="bottomLeft" activeCell="A1" sqref="A1"/></sheetView>',
  ])('refuses changes to unsupported views and preserves exact source XML: %s', async (view) => {
    const { workbook } = fixture()
    const saved = await exportXlsxWorkbook(workbook, 'source.xlsx')
    const parts = unzipSync(saved.bytes!)
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      strFromU8(parts['xl/worksheets/sheet1.xml']).replace(
        '<sheetFormatPr',
        `<sheetViews>${view}</sheetViews><sheetFormatPr`,
      ),
    )
    const bytes = zipSync(parts)
    const imported = (await parseXlsxWorkbook('source.xlsx', bytes)).workbook!
    const session = new WorkbookSession(imported)
    const before = structuredClone(imported)
    expect(() => freeze(session, true, true)).toThrow()
    expect(structuredClone(imported)).toEqual(before)
    expect(session.isDirty).toBe(false)
    const unchanged = await exportXlsxWorkbook(imported, 'unchanged.xlsx')
    expect(Array.from(unchanged.bytes!)).toEqual(Array.from(bytes))
    session.setCells(imported.activeSheetId, [{ address: 'B2', value: { kind: 'number', value: 7 } }])
    const edited = await exportXlsxWorkbook(imported, 'edited.xlsx')
    expect(edited.report.canSave).toBe(true)
    expect(strFromU8(unzipSync(edited.bytes!)['xl/worksheets/sheet1.xml'])).toContain(
      `<sheetViews>${view}</sheetViews>`,
    )
    // Even callers that bypass the command must not overwrite opaque view metadata.
    imported.sheetsById.get(imported.activeSheetId)!.frozenPane = {
      xSplit: 1,
      ySplit: 1,
      state: 'frozen',
      topLeftCell: 'B2',
    }
    const unsafe = await exportXlsxWorkbook(imported, 'unsafe.xlsx')
    expect(unsafe.report.canSave).toBe(false)
    expect(unsafe.bytes).toBeUndefined()
  })
})
