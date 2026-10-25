import { describe, expect, it } from 'vitest'
import { WorkbookSession, createWorkbook, parseRangeAddress } from '../workbook'
import { inferCellValue } from './cell-input'
import { copyFormulas, prepareFormulaPaste, pasteFormulaBlock } from './formula-clipboard'
import { verifiedClipboardCopy } from './clipboard'
import { exportXlsxWorkbook } from '../xlsx/export'
import { parseXlsxWorkbook } from '../xlsx/import'
import { strFromU8, unzipSync } from 'fflate'
import { transformCopyExpression } from '../formulas/row-transform'
import { FormulaRuntime } from '../formulas/runtime'
import { createFormulaWorkbookSnapshot } from '../formulas/types'

describe('PP11 relative formula clipboard', () => {
  it('copies supported scalar source even when its calculated result is an error', async () => {
    const session = new WorkbookSession(createWorkbook())
    const id = session.workbook.activeSheetId
    session.setCell(id, 'A1', inferCellValue('=1/0+B1', 'en', '1900'))
    const runtime = new FormulaRuntime()
    session.applyCalculationResults(
      (await runtime.calculate(createFormulaWorkbookSnapshot(session.workbook, 1), true)).updates,
    )
    const payload = copyFormulas(session, id, [parseRangeAddress('A1')])
    const rows = await prepareFormulaPaste(session.workbook, id, { row: 2, column: 2 }, payload)
    expect(rows[0][0]).toMatchObject({
      kind: 'formula',
      formula: { source: '=1/0+C2', cachedResult: { kind: 'blank' } },
    })
    runtime.reset()
  })
  it('uses an immutable overlapping snapshot and refuses history-budget overflow atomically', async () => {
    const session = new WorkbookSession(createWorkbook())
    const id = session.workbook.activeSheetId
    session.setCell(id, 'A1', { kind: 'number', value: 2 })
    session.setCell(id, 'B1', inferCellValue('=A1', 'en', '1900'))
    session.applyCalculationResults([
      { sheetId: id, address: 'B1', calculationStatus: 'fresh', result: { kind: 'number', value: 2 } },
    ])
    const payload = copyFormulas(session, id, [parseRangeAddress('A1:B1')])
    const original = structuredClone(payload)
    const rows = await prepareFormulaPaste(session.workbook, id, { row: 1, column: 2 }, payload)
    pasteFormulaBlock(session, id, { row: 1, column: 2 }, rows)
    expect(session.getCell(id, 'B1')?.value).toEqual({ kind: 'number', value: 2 })
    expect(session.getCell(id, 'C1')?.value).toMatchObject({ formula: { source: '=B1' } })
    expect(payload).toEqual(original)
    const limited = new WorkbookSession(createWorkbook(), { historyBudgetBytes: 1 })
    const before = structuredClone(limited.workbook)
    expect(() => pasteFormulaBlock(limited, limited.workbook.activeSheetId, { row: 1, column: 1 }, rows)).toThrow()
    expect(limited.workbook).toEqual(before)
    expect(limited.historyState.undoDepth).toBe(0)
    expect(limited.isDirty).toBe(false)
  })
  it.each([
    ['=B2+$C$3+$D4+E$5', 2, 1, '=C4+$C$3+$D6+F$5'],
    ['=SUM($A1:B$4)+MAX(C2,2*(D3+1))', 2, 1, '=SUM($A3:C$4)+MAX(D4,2*(E5+1))'],
    ['=Z1+AZ1', 0, 1, '=AA1+BA1'],
    ['=SUM($A$1:$B$2)+A$1+$A1', 3, 2, '=SUM($A$1:$B$2)+C$1+$A4'],
    ['=AA3+BA3', -2, -1, '=Z1+AZ1'],
    ['=C4+$C$3+$D6+F$5', -2, -1, '=B2+$C$3+$D4+E$5'],
    ['="A1 $B2"&A1', 2, 1, '="A1 $B2"&B3'],
    ["='Sheet1'!A1+Sheet1!$B$2", 2, 1, '=Sheet1!B3+Sheet1!$B$2'],
  ])('transforms %s by %s/%s', async (source, row, column, expected) => {
    const workbook = createWorkbook()
    const result = await transformCopyExpression(source, workbook, workbook.activeSheetId, { row, column })
    expect(result.expression).toBe(expected)
  })

  it.each(['=A1', '=XFD1', '=A1048576', '=UNKNOWN(A1)', '=SUM(A:A)', '=[Book]Sheet1!A1'])(
    'refuses invalid or unsupported %s without mutation',
    async (source) => {
      const workbook = createWorkbook()
      const before = structuredClone(workbook)
      await expect(
        transformCopyExpression(source, workbook, workbook.activeSheetId, {
          row: source === '=A1' ? -1 : 1,
          column: 1,
        }),
      ).rejects.toThrow()
      expect(workbook).toEqual(before)
    },
  )

  it('snapshots a mixed rectangle, transforms before one transaction and restores exact history', async () => {
    const session = new WorkbookSession(createWorkbook())
    const id = session.workbook.activeSheetId
    session.setCells(id, [
      { address: 'A1', value: inferCellValue('=B2+$C$3+$D4+E$5', 'en', '1900') },
      { address: 'B1', value: { kind: 'string', value: '=literal' } },
      { address: 'A2', value: { kind: 'boolean', value: true } },
    ])
    const runtime = new FormulaRuntime()
    session.applyCalculationResults(
      (await runtime.calculate(createFormulaWorkbookSnapshot(session.workbook, 1), true)).updates,
    )
    session.markClean()
    const before = structuredClone(session.workbook)
    const depth = session.historyState.undoDepth
    const payload = copyFormulas(session, id, [parseRangeAddress('A1:B2')])
    const rows = await prepareFormulaPaste(session.workbook, id, { row: 3, column: 2 }, payload)
    // Overlap must read the captured payload, never the now-targeted source cells.
    pasteFormulaBlock(session, id, { row: 3, column: 2 }, rows)
    expect(session.getCell(id, 'B3')?.value).toMatchObject({ kind: 'formula', formula: { source: '=C4+$C$3+$D6+F$5' } })
    expect(session.getCell(id, 'C3')?.value).toEqual({ kind: 'string', value: '=literal' })
    expect(session.historyState.undoDepth).toBe(depth + 1)
    const after = structuredClone(session.workbook)
    session.undo()
    expect(session.workbook).toEqual(before)
    expect(session.isDirty).toBe(false)
    session.redo()
    expect(session.workbook).toEqual(after)
    expect(session.isDirty).toBe(true)
    runtime.reset()
  })

  it('retains quoted apostrophes, Unicode and qualified mixed ranges', async () => {
    const session = new WorkbookSession(createWorkbook())
    session.createSheet("O'Brien Łódź")
    expect(
      (
        await transformCopyExpression(
          "=SUM('O''Brien Łódź'!$A1:B$9)&\"Ą A1\"",
          session.workbook,
          session.workbook.activeSheetId,
          { row: 2, column: 1 },
        )
      ).expression,
    ).toBe("=SUM('O''Brien Łódź'!$A3:C$9)&\"Ą A1\"")
  })

  it.each([null, 'wrong', ''])(
    'rejects missing/mismatched provenance %s including identical external text',
    (token) => {
      const workbook = {}
      const internal = { token: 'current', text: '=A1\nTRUE', workbook }
      expect(verifiedClipboardCopy(internal, token, '=A1\nTRUE', workbook)).toBe(false)
      expect(verifiedClipboardCopy(internal, 'current', '=A2\nTRUE', workbook)).toBe(false)
      expect(verifiedClipboardCopy(internal, 'current', internal.text, {})).toBe(false)
      expect(verifiedClipboardCopy(null, 'current', internal.text, workbook)).toBe(false)
      expect(verifiedClipboardCopy(internal, 'current', '=A1\r\nTRUE', workbook)).toBe(true)
    },
  )

  it('recalculates dependents and later edits, preserves styles, exports exact formulas and reopens', async () => {
    const session = new WorkbookSession(createWorkbook())
    const id = session.workbook.activeSheetId
    const runtime = new FormulaRuntime()
    let generation = 0
    const calculate = async () =>
      session.applyCalculationResults(
        (await runtime.calculate(createFormulaWorkbookSnapshot(session.workbook, ++generation))).updates,
      )
    session.setCell(id, 'A1', { kind: 'number', value: 2 })
    session.setCell(id, 'B1', inferCellValue('=A1+$A$1', 'en', '1900'))
    session.setCell(id, 'F1', inferCellValue('=D3*2', 'en', '1900'))
    session.formatCells(id, [{ address: 'D3', style: { font: { bold: true } } }])
    await calculate()
    const payload = copyFormulas(session, id, [parseRangeAddress('A1:B1')])
    pasteFormulaBlock(
      session,
      id,
      { row: 3, column: 4 },
      await prepareFormulaPaste(session.workbook, id, { row: 3, column: 4 }, payload),
    )
    await calculate()
    expect(session.getCell(id, 'D3')?.style).toEqual({ font: { bold: true } })
    expect(session.getCell(id, 'E3')?.value).toMatchObject({ formula: { cachedResult: { kind: 'number', value: 4 } } })
    session.setCell(id, 'D3', { kind: 'number', value: 7 })
    await calculate()
    expect(session.getCell(id, 'F1')?.value).toMatchObject({ formula: { cachedResult: { kind: 'number', value: 14 } } })
    expect(session.getCell(id, 'E3')?.value).toMatchObject({ formula: { cachedResult: { kind: 'number', value: 9 } } })
    const saved = await exportXlsxWorkbook(session.workbook, 'copy.xlsx')
    expect(saved.report.canSave).toBe(true)
    const xml = strFromU8(unzipSync(saved.bytes!)['xl/worksheets/sheet1.xml'])
    expect(xml).toContain('<f>D3+$A$1</f><v>9</v>')
    const opened = await parseXlsxWorkbook('copy.xlsx', saved.bytes!)
    expect(opened.report.canOpen).toBe(true)
    const imported = new WorkbookSession(opened.workbook!)
    expect(imported.getCell(imported.workbook.activeSheetId, 'E3')?.value).toMatchObject({
      formula: { source: '=D3+$A$1', cachedResult: { kind: 'number', value: 9 } },
    })
    runtime.reset()
  })

  it.each(['overflow', 'unsupported', 'merge', 'disjoint', 'preservation'])(
    'refuses the complete rectangle for %s without workbook/history/dirty changes',
    async (reason) => {
      const session = new WorkbookSession(createWorkbook())
      const id = session.workbook.activeSheetId
      session.setCell(id, 'A1', inferCellValue('=B1', 'en', '1900'))
      session.applyCalculationResults([
        { sheetId: id, address: 'A1', calculationStatus: 'fresh', result: { kind: 'number', value: 0 } },
      ])
      const payload = copyFormulas(session, id, [parseRangeAddress('A1:B1')])
      if (reason === 'unsupported') payload.rows[0][1] = inferCellValue('=UNKNOWN()', 'en', '1900')
      if (reason === 'merge') session.workbook.sheetsById.get(id)!.merges.push(parseRangeAddress('D3:E3'))
      if (reason === 'preservation') session.workbook.formulaStructureUnsafe = true
      session.markClean()
      const before = structuredClone(session.workbook)
      const history = session.historyState
      const perform = async () => {
        if (reason === 'disjoint') copyFormulas(session, id, [parseRangeAddress('A1'), parseRangeAddress('B2')])
        const start = { row: 3, column: reason === 'overflow' ? 16384 : 4 }
        const rows = await prepareFormulaPaste(session.workbook, id, start, payload)
        pasteFormulaBlock(session, id, start, rows)
      }
      await expect(perform()).rejects.toThrow()
      expect(session.workbook).toEqual(before)
      expect(session.historyState).toEqual(history)
      expect(session.isDirty).toBe(false)
    },
  )
})
