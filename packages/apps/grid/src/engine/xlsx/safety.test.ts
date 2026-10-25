import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { WorkbookSession, createWorkbook } from '../workbook'
import { inferCellValue } from '../editing/cell-input'
import { parseXlsxWorkbook } from './import'
import { exportXlsxWorkbook } from './export'
import { preservationFixture, tableAndNoteFixture, threadedFixture } from './fixtures/safety-corpus'
import { FormulaRuntime } from '../formulas/runtime'
import { createFormulaWorkbookSnapshot } from '../formulas/types'

async function open(bytes = preservationFixture()) {
  const result = await parseXlsxWorkbook('source.xlsx', bytes)
  expect(result.report.canOpen).toBe(true)
  return new WorkbookSession(result.workbook!)
}

describe('G-SAFE-01 operation sequences', () => {
  it('blocks a native table header rename that would leave tableColumn names inconsistent with worksheet headers', async () => {
    const parts = unzipSync(tableAndNoteFixture(true, false))
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      strFromU8(parts['xl/worksheets/sheet1.xml']).replace(
        /<row r="1">.*?<\/row>/u,
        '<row r="1"><c r="A1" t="inlineStr"><is><t>Product</t></is></c><c r="B1" t="inlineStr"><is><t>Quantity</t></is></c><c r="C1" t="inlineStr"><is><t>Comment</t></is></c></row>',
      ),
    )
    const session = await open(zipSync(parts))
    const id = session.workbook.activeSheetId
    session.setCell(id, 'A1', { kind: 'string', value: 'Renamed product' })
    const result = await exportXlsxWorkbook(session.workbook, 'header.xlsx')
    expect(result.report.canSave).toBe(false)
    expect(result.bytes).toBeUndefined()
    expect(session.isDirty).toBe(true)
    session.undo()
    expect((await exportXlsxWorkbook(session.workbook, 'undo.xlsx')).report.canSave).toBe(true)
  })
  it('allows literal-only structural edits and multiple edit/undo/redo/save/reopen sequences', async () => {
    const session = new WorkbookSession(createWorkbook())
    const id = session.workbook.activeSheetId
    session.setCell(id, 'B2', { kind: 'number', value: 7 })
    session.setCell(id, 'C3', { kind: 'string', value: 'keep' })
    session.insertRows(id, 2)
    session.insertColumns(id, 2)
    session.undo()
    session.redo()
    session.deleteRows(id, 1)
    session.deleteColumns(id, 1)
    const saved = await exportXlsxWorkbook(session.workbook, 'literal.xlsx')
    expect(saved.report.canSave).toBe(true)
    const reopened = await open(saved.bytes!)
    expect(reopened.getCell(reopened.workbook.activeSheetId, 'B2')?.value).toEqual({ kind: 'number', value: 7 })
    expect(reopened.getCell(reopened.workbook.activeSheetId, 'C3')?.value).toEqual({ kind: 'string', value: 'keep' })
  })

  it('blocks opaque anchors below used cells even when no formula or editable metadata moves', async () => {
    const parts = unzipSync(tableAndNoteFixture(false))
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      strFromU8(parts['xl/worksheets/sheet1.xml']).replace('<c r="C1"><f>SUM(B2,2)</f><v>7</v></c>', ''),
    )
    const session = await open(zipSync(parts))
    const id = session.workbook.activeSheetId
    session.setCell(id, 'B2', { kind: 'number', value: 12 })
    session.insertRows(id, 4)
    expect(session.workbook.formulaStructureUnsafe).toBeUndefined()
    const blocked = await exportXlsxWorkbook(session.workbook, 'blocked.xlsx')
    expect(blocked.report.canSave).toBe(false)
    expect(blocked.bytes).toBeUndefined()
    expect(session.isDirty).toBe(true)
    session.undo()
    expect((await exportXlsxWorkbook(session.workbook, 'safe.xlsx')).report.canSave).toBe(true)
  })
  it('calculates edited supported relative, absolute, range and cross-sheet references and exports exact expressions', async () => {
    const session = await open()
    const id = session.workbook.activeSheetId
    const second = session.workbook.sheetOrder[1]
    session.setCell(second, 'B2', { kind: 'number', value: 9 })
    session.setCell(id, 'B2', { kind: 'number', value: 8 })
    const expressions = ['=B2+1', '=$B$2+2', '=SUM(B2:B3)', '=Second!B2+1']
    expressions.forEach((expression, i) =>
      session.setCell(id, `F${i + 1}`, inferCellValue(expression, 'en', session.workbook.dateSystem)),
    )
    const runtime = new FormulaRuntime()
    const calculation = await runtime.calculate(createFormulaWorkbookSnapshot(session.workbook, 1))
    session.applyCalculationResults(calculation.updates)
    const saved = await exportXlsxWorkbook(session.workbook, 'calculated.xlsx')
    expect(saved.report.canSave).toBe(true)
    const reopened = await open(saved.bytes!)
    for (let i = 0; i < expressions.length; i++)
      expect(reopened.getCell(reopened.workbook.activeSheetId, `F${i + 1}`)?.value).toMatchObject({
        formula: { canonicalExpression: expressions[i], cachedResult: { kind: 'number', value: [9, 10, 8, 10][i] } },
      })
    runtime.reset()
  })

  it('preserves modern threads/persons and their relationships after ordinary edits, blocks structure even below used cells', async () => {
    const bytes = threadedFixture()
    const session = await open(bytes)
    session.setCell(session.workbook.activeSheetId, 'E2', { kind: 'string', value: 'unrelated' })
    const saved = await exportXlsxWorkbook(session.workbook, 'threads.xlsx')
    expect(saved.report.canSave).toBe(true)
    const source = unzipSync(bytes)
    const output = unzipSync(saved.bytes!)
    for (const path of [
      'xl/threadedComments/thread1.xml',
      'xl/persons/person.xml',
      'xl/worksheets/_rels/sheet1.xml.rels',
      'xl/_rels/workbook.xml.rels',
      '[Content_Types].xml',
    ])
      expect([...output[path]]).toEqual([...source[path]])
    expect(strFromU8(output['xl/threadedComments/thread1.xml'])).toContain('ref="D5"')
    session.markClean(saved.preservation, saved.bytes)
    session.insertRows(session.workbook.activeSheetId, 4)
    expect((await exportXlsxWorkbook(session.workbook, 'blocked.xlsx')).bytes).toBeUndefined()
    session.undo()
    expect((await exportXlsxWorkbook(session.workbook, 'undo.xlsx')).report.canSave).toBe(true)
    session.redo()
    expect((await exportXlsxWorkbook(session.workbook, 'redo.xlsx')).bytes).toBeUndefined()
  })

  for (const [name, mutate] of [
    [
      'missing worksheet',
      (parts: Record<string, Uint8Array>) => {
        delete parts['xl/worksheets/sheet1.xml']
      },
    ],
    [
      'malformed XML',
      (parts: Record<string, Uint8Array>) => {
        parts['xl/worksheets/sheet1.xml'] = strToU8('<worksheet><broken></worksheet>')
      },
    ],
    [
      'missing table target',
      (parts: Record<string, Uint8Array>) => {
        delete parts['xl/tables/table1.xml']
      },
    ],
    [
      'escaping relationship',
      (parts: Record<string, Uint8Array>) => {
        parts['xl/worksheets/_rels/sheet1.xml.rels'] = strToU8(
          strFromU8(parts['xl/worksheets/_rels/sheet1.xml.rels']).replace(
            '../tables/table1.xml',
            '../../../escape.xml',
          ),
        )
      },
    ],
  ] as const)
    it(`rejects ${name} before an editable workbook exists`, async () => {
      const parts = unzipSync(tableAndNoteFixture())
      mutate(parts)
      const result = await parseXlsxWorkbook('broken.xlsx', zipSync(parts))
      expect(result.report.canOpen).toBe(false)
      expect(result.workbook).toBeUndefined()
    })
  for (const expression of ['=B2', '=$B$2', '=SUM(B2:B3)', '=Second!B2']) {
    for (const operation of ['insertRows', 'deleteRows', 'insertColumns', 'deleteColumns'] as const) {
      it(`blocks untransformed ${expression} after ${operation}, including redo and clean baselines`, async () => {
        const session = await open()
        const id = session.workbook.activeSheetId
        session.setCell(id, 'D1', inferCellValue(expression, 'en', session.workbook.dateSystem))
        const first = await exportXlsxWorkbook(session.workbook, 'first.xlsx')
        expect(first.report.canSave).toBe(true)
        session.markClean(first.preservation, first.bytes)
        session.setCell(id, 'E8', { kind: 'number', value: 42 })
        session[operation](expression.includes('Second') ? session.workbook.sheetOrder[1] : id, 2)
        for (let cycle = 0; cycle < 2; cycle++) {
          const blocked = await exportXlsxWorkbook(session.workbook, 'blocked.xlsx')
          expect(blocked.report.canSave).toBe(false)
          expect(blocked.bytes).toBeUndefined()
          expect(blocked.report.outputBytes).toBeUndefined()
          expect(session.isDirty).toBe(true)
          session.undo()
          const safe = await exportXlsxWorkbook(session.workbook, 'safe.xlsx')
          expect(safe.report.canSave).toBe(true)
          const reopened = await parseXlsxWorkbook('safe.xlsx', safe.bytes!)
          expect(
            reopened.workbook!.sheetsById.get(reopened.workbook!.sheetOrder[0])!.cells.get('D1')?.value,
          ).toMatchObject({ formula: { canonicalExpression: expression } })
          session.redo()
        }
      })
    }
  }

  it('blocks structural formula corruption in a new workbook without an imported archive', async () => {
    const session = new WorkbookSession(createWorkbook())
    const id = session.workbook.activeSheetId
    session.setCell(id, 'B2', { kind: 'number', value: 7 })
    session.setCell(id, 'C1', inferCellValue('=B2', 'en', session.workbook.dateSystem))
    session.insertRows(id, 2)
    expect((await exportXlsxWorkbook(session.workbook, 'new.xlsx')).bytes).toBeUndefined()
  })

  it('preserves table headers/filter and multiple legacy note/VML anchors after an inside-table edit', async () => {
    const parts = unzipSync(tableAndNoteFixture())
    parts['xl/comments1.xml'] = strToU8(
      strFromU8(parts['xl/comments1.xml']).replace(
        '</commentList>',
        '<comment ref="F8" authorId="0"><text><t>Second note</t></text></comment></commentList>',
      ),
    )
    parts['xl/drawings/vmlDrawing1.vml'] = strToU8(
      strFromU8(parts['xl/drawings/vmlDrawing1.vml']).replace(
        '</xml>',
        '<v:shape id="second"><x:ClientData ObjectType="Note"><x:Anchor>5,0,7,0,6,0,8,0</x:Anchor><x:Row>7</x:Row><x:Column>5</x:Column></x:ClientData></v:shape></xml>',
      ),
    )
    const session = await open(zipSync(parts))
    session.setCell(session.workbook.activeSheetId, 'B2', { kind: 'number', value: 12 })
    const saved = await exportXlsxWorkbook(session.workbook, 'notes.xlsx')
    expect(saved.report.canSave).toBe(true)
    const output = unzipSync(saved.bytes!)
    for (const path of [
      'xl/comments1.xml',
      'xl/drawings/vmlDrawing1.vml',
      'xl/tables/table1.xml',
      'xl/worksheets/_rels/sheet1.xml.rels',
      '[Content_Types].xml',
    ])
      expect([...output[path]]).toEqual([...parts[path]])
    const reopened = await open(saved.bytes!)
    expect(reopened.getCell(reopened.workbook.activeSheetId, 'B2')?.value).toEqual({ kind: 'number', value: 12 })
    session.insertRows(session.workbook.activeSheetId, 4)
    expect((await exportXlsxWorkbook(session.workbook, 'blocked.xlsx')).bytes).toBeUndefined()
  })
})
