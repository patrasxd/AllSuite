import { expect, it } from 'vitest'
import { WorkbookSession } from './session'
import { createWorkbook } from './model'
import { inferCellValue } from '../editing/cell-input'
import { exportXlsxWorkbook } from '../xlsx/export'
import { editWorkbookColumns, editWorkbookRows } from '../formulas/row-structure'
import { FormulaRuntime } from '../formulas/runtime'
import { parseStructuralFormula } from '../formulas/runtime'
import { createFormulaWorkbookSnapshot } from '../formulas/types'
import { parseXlsxWorkbook } from '../xlsx/import'
import { columnNumberToName } from './address'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
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
  return { session, main, other, set, formula }
}

it('PP03 rewrites an absolute column precedent and saves a safe insertion', async () => {
  const session = new WorkbookSession(createWorkbook())
  const id = session.workbook.activeSheetId
  session.setCell(id, 'B1', { kind: 'number', value: 7 })
  session.setCell(id, 'A2', inferCellValue('=$B$1+1', 'en', '1900'))
  await editWorkbookColumns(session, id, 2)
  expect((await exportXlsxWorkbook(session.workbook, 'columns.xlsx')).report.canSave).toBe(true)
  expect(session.getCell(id, 'A2')?.value).toMatchObject({ formula: { canonicalExpression: '=$C$1+1' } })
})

for (const insert of [true, false])
  for (const start of [1, 3, 6])
    for (const absoluteColumn of [false, true])
      for (const absoluteRow of [false, true])
        for (const range of [false, true])
          for (const cross of [false, true])
            it(`PP03 ${insert ? 'insert' : 'delete'} column ${start}, flags ${absoluteColumn}/${absoluteRow}, range ${range}, cross ${cross}`, async () => {
              const { session, main, other, set, formula } = fixture()
              const ref = (column: string, row = 2) =>
                `${absoluteColumn ? '$' : ''}${column}${absoluteRow ? '$' : ''}${row}`
              const prefix = cross ? "'O''Brien data'!" : ''
              set(main, 'H8', `=SUM(${prefix}${ref('B')}${range ? `:${ref('D', 4)}` : ''})`)
              session.formatCells(main, [{ address: 'H8', style: { font: { bold: true } } }])
              session.markClean()
              const before = structuredClone(session.workbook)
              const depth = session.historyState.undoDepth
              await editWorkbookColumns(session, cross ? other : main, start, 1, insert)
              const first = start === 1 ? (insert ? 'C' : 'A') : 'B'
              const last = start === 1 || start === 3 ? (insert ? 'E' : 'C') : 'D'
              const address = cross ? 'H8' : insert ? 'I8' : 'G8'
              const expected = `=SUM(${prefix}${ref(first)}${range ? `:${ref(last, 4)}` : ''})`
              expect(formula(main, address).source).toBe(expected)
              expect(formula(main, address).canonicalExpression).toBe(expected)
              expect(formula(main, address).ast).toEqual(
                (await parseStructuralFormula(expected, session.workbook, main)).ast,
              )
              expect(formula(main, address).cachedResult).toEqual({ kind: 'blank' })
              expect(formula(main, address).calculationStatus).toBe('stale')
              expect(session.getCell(main, address)?.style).toEqual({ font: { bold: true } })
              expect(session.historyState.undoDepth).toBe(depth + 1)
              expect(session.isDirty).toBe(true)
              const after = structuredClone(session.workbook)
              session.undo()
              expect(structuredClone(session.workbook)).toEqual(before)
              expect(session.isDirty).toBe(false)
              session.redo()
              expect(structuredClone(session.workbook)).toEqual(after)
            })

it.each([
  ['=C2', 3, 1, '=#REF!'],
  ['=$C$2', 3, 1, '=#REF!'],
  ['=SUM(B2:D2)', 1, 2, '=SUM(A2:B2)'],
  ['=SUM(B2:D2)', 3, 2, '=SUM(B2)'],
  ['=SUM($B2:D$4)', 2, 3, '=SUM(#REF!)'],
  ['=IFERROR("żółć 👋"&C2,9)', 3, 1, '=IFERROR("żółć 👋"&#REF!,9)'],
])('PP03 deletion %s at %i count %i yields %s', async (source, start, count, expected) => {
  const { session, main, set, formula } = fixture()
  set(main, 'H8', source)
  await editWorkbookColumns(session, main, start, count, false)
  const address = `${columnNumberToName(8 - count)}8`
  expect(formula(main, address).source).toBe(expected)
  const runtime = new FormulaRuntime()
  try {
    session.applyCalculationResults(
      (await runtime.calculate(createFormulaWorkbookSnapshot(session.workbook, 1), true)).updates,
    )
    expect(formula(main, address).cachedResult).toEqual(
      source.includes('IFERROR')
        ? { kind: 'number', value: 9 }
        : expected === '=SUM(A2:B2)' || expected === '=SUM(B2)'
          ? { kind: 'number', value: 0 }
          : { kind: 'error', code: '#REF!' },
    )
    const saved = await exportXlsxWorkbook(session.workbook, 'deleted.xlsx')
    const xml = strFromU8(unzipSync(saved.bytes!)['xl/worksheets/sheet1.xml'])
    expect(xml).toContain(`<f>${expected.slice(1).replaceAll('&', '&amp;')}</f>`)
    if (expected === '=#REF!' || expected === '=SUM(#REF!)') expect(xml).toContain('<v>#REF!</v>')
    const fresh = await parseXlsxWorkbook('deleted.xlsx', saved.bytes!)
    expect(fresh.workbook!.sheetsById.get(fresh.workbook!.sheetOrder[0])!.cells.get(address)?.value).toMatchObject({
      formula: { canonicalExpression: expected },
    })
  } finally {
    runtime.reset()
  }
})

it.each([
  ['Y', 'Z'],
  ['Z', 'AA'],
  ['AA', 'AB'],
  ['AZ', 'BA'],
  ['ZZ', 'AAA'],
  ['XFC', 'XFD'],
])('PP03 insertion %s -> %s and inverse deletion', async (before, after) => {
  const { session, main, set, formula } = fixture()
  set(main, 'A2', `=$${before}$1+${before}1`)
  await editWorkbookColumns(session, main, 2)
  expect(formula(main, 'A2').source).toBe(`=$${after}$1+${after}1`)
  await editWorkbookColumns(session, main, 2, 1, false)
  expect(formula(main, 'A2').source).toBe(`=$${before}$1+${before}1`)
})

it.each(['=XFD1', '=$XFD$1', '=SUM(XFC1:XFD2)'])('PP03 overflow %s is atomic', async (source) => {
  const { session, main, set } = fixture()
  set(main, 'A2', source)
  const before = structuredClone(session.workbook)
  const history = session.historyState
  await expect(editWorkbookColumns(session, main, 2)).rejects.toThrow(/limits/)
  expect(structuredClone(session.workbook)).toEqual(before)
  expect(session.historyState).toEqual(history)
})

it('PP03 final column, deleted final target and moving cell overflow', async () => {
  const { session, main, set, formula } = fixture()
  set(main, 'A2', '=XFC1')
  await editWorkbookColumns(session, main, 16384)
  expect(formula(main, 'A2').source).toBe('=XFC1')
  set(main, 'XFD1', '7')
  await expect(editWorkbookColumns(session, main, 2)).rejects.toThrow(/limits/)
  set(main, 'A2', '=$XFD$1')
  await editWorkbookColumns(session, main, 16384, 1, false)
  expect(formula(main, 'A2').source).toBe('=#REF!')
})

it.each([
  [0, 1],
  [1, 0],
  [16384, 2],
  [1.5, 1],
  [1, 1.5],
])('PP03 invalid coordinates %i/%i refuse', async (start, count) => {
  const { session, main } = fixture()
  const before = structuredClone(session.workbook)
  await expect(editWorkbookColumns(session, main, start, count)).rejects.toThrow()
  expect(structuredClone(session.workbook)).toEqual(before)
})

it.each([
  '=Table1[Amount]',
  '=[other.xlsx]Main!A1',
  '=Main:Last!A1',
  '=NotAName+1',
  '=SEQUENCE(3)',
  '=SUM(A:A)',
  '=SUM(1:3)',
  '=SUM(D2:B2)',
  '=A0',
  '=XFE1',
  '=SUM({1,2})',
  '=SUM(',
  '=Missing!A1',
  '=INDEX(B2:C2,1,0)',
])('PP03 unsupported %s refuses without changing workbook/history/dirty', async (source) => {
  const { session, main, other, set } = fixture()
  set(main, 'H8', '=B2+1')
  set(other, 'A1', source)
  session.markClean()
  const before = structuredClone(session.workbook)
  const history = session.historyState
  await expect(editWorkbookColumns(session, main, 2)).rejects.toThrow()
  expect(structuredClone(session.workbook)).toEqual(before)
  expect(session.historyState).toEqual(history)
  expect(session.isDirty).toBe(false)
})

it.each([
  ['table/note/drawing', tableAndNoteFixture],
  ['thread', threadedFixture],
  ['unknown relationship', preservationFixture],
] as const)('PP03 imported %s refusal retains preservation', async (_name, makeBytes) => {
  const imported = await parseXlsxWorkbook('opaque.xlsx', makeBytes())
  const session = new WorkbookSession(imported.workbook!)
  const before = structuredClone(session.workbook)
  await expect(editWorkbookColumns(session, session.workbook.activeSheetId, 4)).rejects.toThrow()
  expect(structuredClone(session.workbook)).toEqual(before)
  expect(session.isDirty).toBe(false)
  expect(session.historyState.canUndo).toBe(false)
})

it.each(['shared', 'array', 'dataTable', 'sheetProtection', 'colBreaks', 'ignoredErrors'])(
  'PP03 imported %s refuses before mutation',
  async (type) => {
    const { session, main, set } = fixture()
    set(main, 'A2', '=B1')
    const parts = unzipSync((await exportXlsxWorkbook(session.workbook, 'guard.xlsx')).bytes!)
    const xml = strFromU8(parts['xl/worksheets/sheet1.xml'])
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      ['shared', 'array', 'dataTable'].includes(type)
        ? xml.replace('<f>', `<f t="${type}" ref="A2:B2" si="0">`)
        : xml.replace('</worksheet>', `<${type}/></worksheet>`),
    )
    const imported = await parseXlsxWorkbook('guard.xlsx', zipSync(parts))
    const fresh = new WorkbookSession(imported.workbook!)
    const before = structuredClone(fresh.workbook)
    await expect(editWorkbookColumns(fresh, fresh.workbook.activeSheetId, 2)).rejects.toThrow()
    expect(structuredClone(fresh.workbook)).toEqual(before)
  },
)

it.each([true, false])(
  'PP03 combined axes (%s), dependencies, checkpoints, XML and fresh session',
  async (rowFirst) => {
    const { session, main, other, set, formula } = fixture()
    const runtime = new FormulaRuntime()
    let generation = 0
    const calculate = async (rebuild = false) =>
      session.applyCalculationResults(
        (await runtime.calculate(createFormulaWorkbookSnapshot(session.workbook, ++generation), rebuild)).updates,
      )
    try {
      set(other, 'B2', '7')
      set(other, 'D2', '3')
      set(main, 'A1', "=SUM('O''Brien data'!$B2:D$2)")
      set(main, 'A2', '=A1*2')
      set(other, 'H8', '=Main!A2+1')
      set(other, 'H9', "=SUM('O''Brien data'!B2:D2)")
      await calculate()
      session.markClean()
      const before = structuredClone(session.workbook)
      const depth = session.historyState.undoDepth
      const checkpoint = session.createSaveCheckpoint()
      if (rowFirst) {
        await editWorkbookRows(session, other, 2)
        await editWorkbookColumns(session, other, 3)
      } else {
        await editWorkbookColumns(session, other, 1, 1, false)
        await editWorkbookRows(session, other, 2)
      }
      const expression = rowFirst ? "=SUM('O''Brien data'!$B3:E$3)" : "=SUM('O''Brien data'!$A3:C$3)"
      const moved = rowFirst ? 'I9' : 'G9'
      const sameSheet = rowFirst ? 'I10' : 'G10'
      const precedent = rowFirst ? 'C3' : 'B3'
      expect(formula(main, 'A1').source).toBe(expression)
      expect(formula(other, sameSheet).source).toBe(
        rowFirst ? "=SUM('O''Brien data'!B3:E3)" : "=SUM('O''Brien data'!A3:C3)",
      )
      expect(formula(main, 'A1').cachedResult).toEqual({ kind: 'blank' })
      expect(session.historyState.undoDepth).toBe(depth + 2)
      const after = structuredClone(session.workbook)
      expect(session.markSaved(checkpoint)).toBe(false)
      session.undo()
      session.undo()
      expect(structuredClone(session.workbook)).toEqual(before)
      expect(session.isDirty).toBe(false)
      session.redo()
      session.redo()
      expect(structuredClone(session.workbook)).toEqual(after)
      const stale = await exportXlsxWorkbook(session.workbook, 'stale.xlsx')
      expect(strFromU8(unzipSync(stale.bytes!)['xl/worksheets/sheet1.xml'])).not.toContain('</f><v>10</v>')
      await calculate(true)
      expect(formula(other, moved).cachedResult).toEqual({ kind: 'number', value: 21 })
      set(other, precedent, '5')
      await calculate()
      expect(formula(main, 'A1').cachedResult).toEqual({ kind: 'number', value: 15 })
      expect(formula(other, moved).cachedResult).toEqual({ kind: 'number', value: 31 })
      set(other, precedent, '10')
      await calculate()
      expect(formula(other, moved).cachedResult).toEqual({ kind: 'number', value: 41 })
      expect(formula(other, sameSheet).cachedResult).toEqual({ kind: 'number', value: 20 })
      const saved = await exportXlsxWorkbook(session.workbook, 'combined.xlsx')
      const parts = unzipSync(saved.bytes!)
      expect(strFromU8(parts['xl/worksheets/sheet1.xml'])).toContain(`<f>${expression.slice(1)}</f><v>20</v>`)
      expect(strFromU8(parts['xl/worksheets/sheet2.xml'])).toContain(`<c r="${moved}"><f>Main!A2+1</f><v>41</v></c>`)
      expect(strFromU8(parts['xl/_rels/workbook.xml.rels'])).toContain('worksheets/sheet2.xml')
      expect(strFromU8(parts['xl/workbook.xml'])).toContain('name="O\'Brien data"')
      const reopened = await parseXlsxWorkbook('combined.xlsx', saved.bytes!)
      const fresh = new WorkbookSession(reopened.workbook!)
      const [first, second] = fresh.workbook.sheetOrder
      expect(fresh.getCell(first, 'A1')?.value).toMatchObject({
        formula: { canonicalExpression: expression, cachedResult: { value: 20 } },
      })
      expect(fresh.getCell(second, moved)?.value).toMatchObject({
        formula: { canonicalExpression: '=Main!A2+1', cachedResult: { value: 41 } },
      })
      // A supported imported package must permit another safe column operation.
      await editWorkbookColumns(fresh, second, 1)
      const recalculated = await runtime.calculate(createFormulaWorkbookSnapshot(fresh.workbook, ++generation), true)
      fresh.applyCalculationResults(recalculated.updates)
      expect(fresh.getCell(first, 'A1')?.value).toMatchObject({ formula: { cachedResult: { value: 20 } } })
    } finally {
      runtime.reset()
    }
  },
)

it('PP03 retains old safety flags, defined-name refusals, budget and revision checks', async () => {
  const { session, main, set } = fixture()
  set(main, 'A2', '=B1')
  session.insertRows(main, 1)
  expect(session.workbook.formulaStructureUnsafe).toBe(true)
  await expect(editWorkbookColumns(session, main, 2)).rejects.toThrow()
  expect(session.workbook.formulaStructureUnsafe).toBe(true)
  session.undo()
  session.addDefinedName({ name: 'Named', formula: '=Main!B1' })
  await expect(editWorkbookColumns(session, main, 2)).rejects.toThrow()
  session.undo()
  const pending = editWorkbookColumns(session, main, 2)
  set(main, 'B1', '99')
  await expect(pending).rejects.toThrow(/changed/)
  expect(session.getCell(main, 'B1')?.value).toEqual({ kind: 'number', value: 99 })
  const replacement = editWorkbookColumns(session, main, 2)
  session.replaceWorkbook(createWorkbook())
  await expect(replacement).rejects.toThrow(/changed/)
  const small = new WorkbookSession(createWorkbook(), { historyBudgetBytes: 1 })
  small.workbook.sheetsById.get(small.workbook.activeSheetId)!.cells.set('B1', { value: { kind: 'number', value: 7 } })
  const before = structuredClone(small.workbook)
  await expect(editWorkbookColumns(small, small.workbook.activeSheetId, 1)).rejects.toThrow(/history/)
  expect(structuredClone(small.workbook)).toEqual(before)
  expect(small.historyState.canUndo).toBe(false)
})

it('PP03 refuses imported unowned column metadata instead of dropping it', async () => {
  const { session, main, set } = fixture()
  set(main, 'A2', '=B1')
  session.setColumnMetadata(main, 2, { width: 23, hidden: true, outlineLevel: 1 })
  const parts = unzipSync((await exportXlsxWorkbook(session.workbook, 'columns.xlsx')).bytes!)
  parts['xl/worksheets/sheet1.xml'] = strToU8(
    strFromU8(parts['xl/worksheets/sheet1.xml']).replace('<col ', '<col collapsed="1" '),
  )
  const imported = await parseXlsxWorkbook('columns.xlsx', zipSync(parts))
  const fresh = new WorkbookSession(imported.workbook!)
  const before = structuredClone(fresh.workbook)
  await expect(editWorkbookColumns(fresh, fresh.workbook.activeSheetId, 2)).rejects.toThrow()
  expect(structuredClone(fresh.workbook)).toEqual(before)
})

it('PP03 moves supported column metadata and styles through imported save/reopen', async () => {
  const { session, main, set } = fixture()
  set(main, 'B1', '7')
  set(main, 'A2', '=$B$1')
  session.formatCells(main, [{ address: 'B1', style: { font: { bold: true }, numberFormat: '0.00' } }])
  session.setColumnMetadata(main, 2, { width: 23, hidden: true, outlineLevel: 1 })
  const saved = await exportXlsxWorkbook(session.workbook, 'columns.xlsx')
  const imported = await parseXlsxWorkbook('columns.xlsx', saved.bytes!)
  const fresh = new WorkbookSession(imported.workbook!)
  const id = fresh.workbook.sheetOrder[0]
  const style = fresh.getCell(id, 'B1')!.style
  await editWorkbookColumns(fresh, id, 2)
  expect(fresh.workbook.sheetsById.get(id)!.columnMetadata.get(3)).toMatchObject({
    width: 23,
    hidden: true,
    outlineLevel: 1,
  })
  expect(fresh.getCell(id, 'C1')!.style).toEqual(style)
  const output = await exportXlsxWorkbook(fresh.workbook, 'columns.xlsx')
  const xml = strFromU8(unzipSync(output.bytes!)['xl/worksheets/sheet1.xml'])
  expect(xml).toContain('min="3" max="3"')
  expect(xml).toContain('hidden="1"')
  const reopened = await parseXlsxWorkbook('columns.xlsx', output.bytes!)
  const sheet = reopened.workbook!.sheetsById.get(reopened.workbook!.sheetOrder[0])!
  expect(sheet.columnMetadata.get(3)).toMatchObject({ width: 23, hidden: true, outlineLevel: 1 })
  expect(sheet.cells.get('C1')!.style).toEqual(style)
})
