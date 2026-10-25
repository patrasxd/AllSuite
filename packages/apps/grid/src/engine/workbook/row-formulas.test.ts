import { describe, expect, it } from 'vitest'
import { editWorkbookRows } from '../formulas/row-structure'
import { WorkbookSession } from './session'
import { createWorkbook } from './model'
import { inferCellValue } from '../editing/cell-input'
import { exportXlsxWorkbook } from '../xlsx/export'
import { parseXlsxWorkbook } from '../xlsx/import'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { FormulaRuntime } from '../formulas/runtime'
import { createFormulaWorkbookSnapshot } from '../formulas/types'
import { transformRowExpression } from '../formulas/row-transform'
import { tableAndNoteFixture, threadedFixture, preservationFixture } from '../xlsx/fixtures/safety-corpus'

function fixture() {
  const session = new WorkbookSession(createWorkbook({ firstSheetName: 'Main' }))
  const main = session.workbook.activeSheetId
  const other = session.createSheet("O'Brien data")
  const set = (id: string, address: string, text: string) =>
    session.setCell(id, address, inferCellValue(text, 'en', '1900'))
  const formula = (id: string, address: string) => {
    const value = session.getCell(id, address)?.value
    if (value?.kind !== 'formula') throw new Error(`Missing formula ${address}`)
    return value.formula
  }
  const runtime = new FormulaRuntime()
  let generation = 0
  const calculate = async (rebuild = false) =>
    session.applyCalculationResults(
      (await runtime.calculate(createFormulaWorkbookSnapshot(session.workbook, ++generation), rebuild)).updates,
    )
  return { session, main, other, set, formula, runtime, calculate }
}

describe('PP02 supported row operations', () => {
  it('rewrites an absolute precedent and saves instead of blocking a safe row insertion', async () => {
    const session = new WorkbookSession(createWorkbook())
    const id = session.workbook.activeSheetId
    session.setCell(id, 'A2', { kind: 'number', value: 7 })
    session.setCell(id, 'B1', inferCellValue('=$A$2+1', 'en', '1900'))
    await editWorkbookRows(session, id, 2)
    expect((await exportXlsxWorkbook(session.workbook, 'rows.xlsx')).report.canSave).toBe(true)
    expect(session.getCell(id, 'B1')?.value).toMatchObject({ formula: { canonicalExpression: '=$A$3+1' } })
  })

  for (const insert of [true, false])
    for (const start of [1, 3, 6])
      for (const flags of ['', '$column', '$row', '$both'])
        for (const range of [false, true])
          for (const cross of [false, true]) {
            it(`${insert ? 'insert' : 'delete'} row ${start}, ${flags || 'relative'}, ${range ? 'range' : 'single'}, ${cross ? 'quoted cross-sheet' : 'same-sheet'} with undo/redo`, async () => {
              const { session, main, other, set, formula } = fixture()
              const column = flags === '$column' || flags === '$both' ? '$A' : 'A'
              const rowFlag = flags === '$row' || flags === '$both' ? '$' : ''
              const prefix = cross ? "'O''Brien data'!" : ''
              const expression = `=SUM(${prefix}${column}${rowFlag}2${range ? `:${column}${rowFlag}4` : ''})`
              set(main, 'D8', expression)
              const target = cross ? other : main
              const before = structuredClone(session.workbook)
              const history = session.historyState.undoDepth
              const checkpoint = session.createSaveCheckpoint()
              session.markSaved(checkpoint)
              await editWorkbookRows(session, target, start, 1, insert)
              const first = start === 1 ? (insert ? 3 : 1) : 2
              const last = start === 1 || start === 3 ? (insert ? 5 : 3) : 4
              const expected = `=SUM(${prefix}${column}${rowFlag}${first}${range ? `:${column}${rowFlag}${last}` : ''})`
              const moved = cross ? 'D8' : insert ? 'D9' : 'D7'
              expect(formula(main, moved).canonicalExpression).toBe(expected)
              expect(formula(main, moved).cachedResult).toEqual({ kind: 'blank' })
              expect(session.historyState.undoDepth).toBe(history + 1)
              expect(session.isDirty).toBe(true)
              const after = structuredClone(session.workbook)
              session.undo()
              expect(structuredClone(session.workbook)).toEqual(before)
              expect(session.isDirty).toBe(false)
              session.redo()
              expect(structuredClone(session.workbook)).toEqual(after)
              expect(session.isDirty).toBe(true)
            })
          }

  it.each([
    ['=A3', 3, 1, '=#REF!'],
    ['=$A$3', 3, 1, '=#REF!'],
    ['=SUM(A2:A4)', 1, 2, '=SUM(A1:A2)'],
    ['=SUM(A2:A4)', 3, 2, '=SUM(A2)'],
    ['=SUM($A2:A$4)', 2, 3, '=SUM(#REF!)'],
    ['=IFERROR(A3,9)', 3, 1, '=IFERROR(#REF!,9)'],
  ])('deletion %s at %i count %i yields %s', async (expression, start, count, expected) => {
    const { session, main, set, formula, calculate, runtime } = fixture()
    set(main, 'D8', expression)
    await editWorkbookRows(session, main, start, count, false)
    const address = `D${8 - count}`
    expect(formula(main, address).canonicalExpression).toBe(expected)
    await calculate(true)
    expect(formula(main, address).cachedResult).toEqual(
      expression.includes('IFERROR')
        ? { kind: 'number', value: 9 }
        : expression.includes('SUM') && expected !== '=SUM(#REF!)'
          ? { kind: 'number', value: 0 }
          : { kind: 'error', code: '#REF!' },
    )
    runtime.reset()
  })

  it.each([
    '=1+(A2*3)^2',
    '=IF(A1,"żółć 👋",A2)',
    '=SUM($A2:B$4)+1',
    '=A2%',
    '=-A2',
    '=A2&"[literal]"',
    "=SUM('O''Brien data'!A2:A4)",
    '=IFERROR(#REF!,A2)',
    '=IF(A2>1,TRUE,FALSE)',
  ])('proves unchanged serialization and transformed parse fidelity for %s', async (source) => {
    const { session, main } = fixture()
    const noChange = await transformRowExpression(source, session.workbook, main, {
      sheetId: main,
      start: 100,
      count: 1,
      insert: true,
    })
    expect(noChange.expression).toBe(source)
    const shifted = await transformRowExpression(source, session.workbook, main, {
      sheetId: main,
      start: 2,
      count: 1,
      insert: true,
    })
    expect(shifted.ast).toBeTruthy()
  })

  it.each([
    '=Table1[Amount]',
    '=[other.xlsx]Main!A1',
    '=Main:Last!A1',
    '=NotAName+1',
    '=SEQUENCE(3)',
    '=SUM(A:A)',
    '=SUM(1:3)',
    '=SUM(A4:A2)',
    '=A0',
    '=XFE1',
    '=A1048577',
    '=SUM({1,2})',
    '=SUM(',
    '=Missing!A1',
  ])('refuses unsupported %s atomically', async (expression) => {
    const { session, main, other, set } = fixture()
    set(main, 'D1', '=A2+1')
    set(other, 'D1', expression)
    const before = structuredClone(session.workbook)
    const history = session.historyState
    await expect(editWorkbookRows(session, main, 2)).rejects.toThrow()
    expect(structuredClone(session.workbook)).toEqual(before)
    expect(session.historyState).toEqual(history)
  })

  it.each(['=A1048576', '=SUM(A1048575:A1048576)', '=$A$1048576'])(
    'rejects reference overflow %s before mutation',
    async (expression) => {
      const { session, main, set } = fixture()
      set(main, 'D1', expression)
      const before = structuredClone(session.workbook)
      await expect(editWorkbookRows(session, main, 1)).rejects.toThrow()
      expect(structuredClone(session.workbook)).toEqual(before)
    },
  )

  it.each([
    [0, 1],
    [1, 0],
    [1048576, 2],
    [1.5, 1],
    [1, 1.5],
  ])('rejects invalid row start/count %i/%i', async (start, count) => {
    const { session, main } = fixture()
    const before = structuredClone(session.workbook)
    await expect(editWorkbookRows(session, main, start, count)).rejects.toThrow()
    expect(structuredClone(session.workbook)).toEqual(before)
  })

  it('handles the final legal row, deleted final targets and moving-cell overflow', async () => {
    const { session, main, set, formula } = fixture()
    set(main, 'B1', '=A1048575')
    await editWorkbookRows(session, main, 1048576)
    expect(formula(main, 'B1').canonicalExpression).toBe('=A1048575')
    set(main, 'A1048576', '7')
    await expect(editWorkbookRows(session, main, 1)).rejects.toThrow()
    set(main, 'B1', '=$A$1048576')
    await editWorkbookRows(session, main, 1048576, 1, false)
    expect(formula(main, 'B1').canonicalExpression).toBe('=#REF!')
  })

  it('rebuilds multiple cross-sheet dependencies, responds to later edits, saves exact formulas/caches and fresh reopens', async () => {
    const { session, main, other, set, formula, calculate, runtime } = fixture()
    set(other, 'A2', '7')
    set(other, 'A3', '3')
    set(main, 'B1', "=SUM('O''Brien data'!$A2:A$3)")
    set(main, 'C1', '=B1*2')
    set(other, 'D4', '=Main!C1+1')
    await calculate()
    const before = structuredClone(session.workbook)
    session.markClean()
    await editWorkbookRows(session, other, 2)
    expect(formula(main, 'B1').canonicalExpression).toBe("=SUM('O''Brien data'!$A3:A$4)")
    expect(formula(other, 'D5').canonicalExpression).toBe('=Main!C1+1')
    await calculate(true)
    expect(formula(other, 'D5').cachedResult).toEqual({ kind: 'number', value: 21 })
    set(other, 'A3', '12')
    await calculate()
    expect(formula(main, 'B1').cachedResult).toEqual({ kind: 'number', value: 15 })
    expect(formula(main, 'C1').cachedResult).toEqual({ kind: 'number', value: 30 })
    expect(formula(other, 'D5').cachedResult).toEqual({ kind: 'number', value: 31 })
    session.undo() // precedent edit
    await calculate()
    session.undo() // entire row operation
    expect(structuredClone(session.workbook)).toEqual(before)
    expect(session.isDirty).toBe(false)
    session.redo()
    await calculate(true)
    const saved = await exportXlsxWorkbook(session.workbook, 'references.xlsx')
    expect(saved.report.canSave).toBe(true)
    const parts = unzipSync(saved.bytes!)
    expect(strFromU8(parts['xl/worksheets/sheet1.xml'])).toContain("<f>SUM('O''Brien data'!$A3:A$4)</f><v>10</v>")
    expect(strFromU8(parts['xl/worksheets/sheet2.xml'])).toContain('<c r="D5"><f>Main!C1+1</f><v>21</v></c>')
    const checkpoint = session.createSaveCheckpoint()
    session.markSaved(checkpoint, saved.preservation, saved.bytes)
    expect(session.isDirty).toBe(false)
    const reopened = await parseXlsxWorkbook('references.xlsx', saved.bytes!)
    expect(reopened.report.canOpen).toBe(true)
    const fresh = new WorkbookSession(reopened.workbook!)
    const first = fresh.workbook.sheetOrder[0]
    const second = fresh.workbook.sheetOrder[1]
    expect(fresh.getCell(first, 'B1')?.value).toMatchObject({
      formula: { canonicalExpression: "=SUM('O''Brien data'!$A3:A$4)", cachedResult: { value: 10 } },
    })
    // The saved simple package itself is eligible for another preflight operation.
    await editWorkbookRows(fresh, second, 3, 1, false)
    const recalc = await runtime.calculate(createFormulaWorkbookSnapshot(fresh.workbook, 100), true)
    fresh.applyCalculationResults(recalc.updates)
    expect(fresh.getCell(first, 'B1')?.value).toMatchObject({
      formula: { canonicalExpression: "=SUM('O''Brien data'!$A3:A$3)", cachedResult: { value: 3 } },
    })
    runtime.reset()
  })

  it.each([
    ['table/note', () => tableAndNoteFixture()],
    ['thread', threadedFixture],
    ['unknown part', preservationFixture],
  ] as const)('preflights %s preservation before any mutation', async (_name, bytes) => {
    const imported = await parseXlsxWorkbook('opaque.xlsx', bytes())
    const session = new WorkbookSession(imported.workbook!)
    const before = structuredClone(session.workbook)
    await expect(editWorkbookRows(session, session.workbook.activeSheetId, 4)).rejects.toThrow()
    expect(structuredClone(session.workbook)).toEqual(before)
    expect(session.isDirty).toBe(false)
    expect(session.historyState.canUndo).toBe(false)
  })

  it.each(['shared', 'array', 'dataTable'])('refuses original %s formula families', async (type) => {
    const { session, main, set } = fixture()
    set(main, 'B1', '=A2')
    const saved = await exportXlsxWorkbook(session.workbook, 'family.xlsx')
    const parts = unzipSync(saved.bytes!)
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      strFromU8(parts['xl/worksheets/sheet1.xml']).replace('<f>', `<f t="${type}" ref="B1:B2" si="0">`),
    )
    const imported = await parseXlsxWorkbook('family.xlsx', zipSync(parts))
    expect(imported.report.canOpen).toBe(true)
    const fresh = new WorkbookSession(imported.workbook!)
    const before = structuredClone(fresh.workbook)
    await expect(editWorkbookRows(fresh, fresh.workbook.activeSheetId, 2)).rejects.toThrow()
    expect(structuredClone(fresh.workbook)).toEqual(before)
  })

  it('never clears an existing safety flag, refuses defined names and preserves history budgets', async () => {
    const { session, main, set, calculate, runtime } = fixture()
    set(main, 'B1', '=A2')
    session.insertColumns(main, 1)
    await calculate(true)
    expect(session.workbook.formulaStructureUnsafe).toBe(true)
    await expect(editWorkbookRows(session, main, 2)).rejects.toThrow()
    session.undo()
    session.addDefinedName({ name: 'Named', formula: '=Main!A2' })
    await expect(editWorkbookRows(session, main, 2)).rejects.toThrow()
    const smallWorkbook = createWorkbook()
    smallWorkbook.sheetsById.get(smallWorkbook.activeSheetId)!.cells.set('A2', { value: { kind: 'number', value: 7 } })
    const small = new WorkbookSession(smallWorkbook, { historyBudgetBytes: 1 })
    await expect(editWorkbookRows(small, small.workbook.activeSheetId, 1)).rejects.toThrow(/history/)
    expect(small.historyState.canUndo).toBe(false)
    runtime.reset()
  })

  it('rejects a stale preflight plan after an intervening edit or replacement', async () => {
    const { session, main, set } = fixture()
    set(main, 'B1', '=A2')
    const pending = editWorkbookRows(session, main, 2)
    set(main, 'A2', '99')
    await expect(pending).rejects.toThrow(/changed/)
    expect(session.getCell(main, 'A2')?.value).toEqual({ kind: 'number', value: 99 })
    const replacement = editWorkbookRows(session, main, 2)
    session.replaceWorkbook(createWorkbook())
    await expect(replacement).rejects.toThrow(/changed/)
  })

  it('rejects a scalar-engine expression that actually spills before row mutation', async () => {
    const { session, main, set } = fixture()
    set(main, 'A2', '7')
    set(main, 'A3', '3')
    set(main, 'D1', '=INDEX(A2:A3,0,1)')
    const before = structuredClone(session.workbook)
    await expect(editWorkbookRows(session, main, 2)).rejects.toThrow()
    expect(structuredClone(session.workbook)).toEqual(before)
  })

  it('expands range dependencies on insert inside, shifts explicit same-sheet refs, and omits stale XLSX caches', async () => {
    const { session, main, set, formula, calculate, runtime } = fixture()
    set(main, 'A2', '7')
    set(main, 'A3', '3')
    set(main, 'D1', '=SUM(Main!$A$2:$A$3)')
    await calculate()
    await editWorkbookRows(session, main, 3)
    expect(formula(main, 'D1').canonicalExpression).toBe('=SUM(Main!$A$2:$A$4)')
    const stale = await exportXlsxWorkbook(session.workbook, 'stale.xlsx')
    expect(stale.report.canSave).toBe(true)
    const xml = strFromU8(unzipSync(stale.bytes!)['xl/worksheets/sheet1.xml'])
    expect(xml).toContain('<f>SUM(Main!$A$2:$A$4)</f>')
    expect(xml).not.toContain('</f><v>10</v>')
    set(main, 'A3', '5')
    await calculate(true)
    expect(formula(main, 'D1').cachedResult).toEqual({ kind: 'number', value: 15 })
    set(main, 'A3', '10')
    await calculate()
    expect(formula(main, 'D1').cachedResult).toEqual({ kind: 'number', value: 20 })
    runtime.reset()
  })

  it.each(['sheetProtection', 'rowBreaks', 'ignoredErrors'])(
    'refuses imported %s anchors/protection before mutation',
    async (tag) => {
      const { session, main, set } = fixture()
      set(main, 'A2', '7')
      const saved = await exportXlsxWorkbook(session.workbook, 'guard.xlsx')
      const parts = unzipSync(saved.bytes!)
      parts['xl/worksheets/sheet1.xml'] = strToU8(
        strFromU8(parts['xl/worksheets/sheet1.xml']).replace('</worksheet>', `<${tag}/></worksheet>`),
      )
      const imported = await parseXlsxWorkbook('guard.xlsx', zipSync(parts))
      const fresh = new WorkbookSession(imported.workbook!)
      const before = structuredClone(fresh.workbook)
      await expect(editWorkbookRows(fresh, fresh.workbook.activeSheetId, 2)).rejects.toThrow()
      expect(structuredClone(fresh.workbook)).toEqual(before)
    },
  )

  it('keeps a deferred save checkpoint dirty after rows and restores clean on undo', async () => {
    const { session, main, set } = fixture()
    set(main, 'A2', '7')
    set(main, 'B1', '=A2')
    const checkpoint = session.createSaveCheckpoint()
    await editWorkbookRows(session, main, 2)
    expect(session.markSaved(checkpoint)).toBe(false)
    expect(session.isDirty).toBe(true)
    session.undo()
    expect(session.isDirty).toBe(false)
    session.redo()
    expect(session.isDirty).toBe(true)
  })

  it('deletes references after UTF-8 literals without corrupting the error token or IFERROR meaning', async () => {
    const { session, main, set, formula, calculate, runtime } = fixture()
    set(main, 'A2', '7')
    set(main, 'B1', '=IFERROR("żółć 👋"&A2,"ok")')
    await editWorkbookRows(session, main, 2, 1, false)
    expect(formula(main, 'B1').canonicalExpression).toBe('=IFERROR("żółć 👋"&#REF!,"ok")')
    await calculate(true)
    expect(formula(main, 'B1').cachedResult).toEqual({ kind: 'string', value: 'ok' })
    runtime.reset()
  })
})
