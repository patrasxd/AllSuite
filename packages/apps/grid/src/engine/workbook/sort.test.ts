import { describe, expect, it } from 'vitest'
import { createWorkbook, WorkbookSession } from './index'
import { parseRangeAddress } from './address'
import type { CellValue } from './types'
import { createWorksheet, getUsedRange } from './model'
import { inferCellValue } from '../editing/cell-input'
import { exportXlsxWorkbook } from '../xlsx/export'
import { parseXlsxWorkbook } from '../xlsx/import'
import { tableAndNoteFixture, preservationFixture } from '../xlsx/fixtures/safety-corpus'

function fixture(keys: CellValue[] = [3, 1, 1, 2].map((value) => ({ kind: 'number', value }))) {
  const workbook = createWorkbook()
  const sheet = workbook.sheetsById.get(workbook.activeSheetId)!
  keys.forEach((value, i) => {
    sheet.cells.set(`A${i + 1}`, { value })
    sheet.cells.set(`B${i + 1}`, {
      value: { kind: 'string', value: `record-${i}` },
      style: { font: { bold: i % 2 === 0 }, fill: { color: i % 2 === 0 ? '#FF0000' : '#00FF00' } },
    })
  })
  sheet.dimensions.usedRange = getUsedRange(sheet.cells, sheet.merges)
  return { workbook, sheet, session: new WorkbookSession(workbook) }
}

function sort(session: WorkbookSession, direction: 'ascending' | 'descending' = 'ascending', headers = false) {
  return session.execute({
    type: 'sort-range',
    sheetId: session.workbook.activeSheetId,
    range: parseRangeAddress('A1:B4'),
    keyColumn: 1,
    direction,
    headers,
  })
}

describe('PP04 ordinary range sorting', () => {
  it('sorts ascending complete styled records stably and atomically undoes/redoes', () => {
    const { workbook, sheet, session } = fixture()
    const before = structuredClone(workbook)
    expect(sort(session)).toBe(true)
    expect([1, 2, 3, 4].map((r) => sheet.cells.get(`B${r}`))).toEqual(
      [2, 3, 4, 1].map((r) => before.sheetsById.get(sheet.id)!.cells.get(`B${r}`)),
    )
    expect(session.historyState.undoDepth).toBe(1)
    expect(session.isDirty).toBe(true)
    const after = structuredClone(workbook)
    session.undo()
    expect(workbook).toEqual(before)
    expect(session.isDirty).toBe(false)
    session.redo()
    expect(workbook).toEqual(after)
  })

  it.each([false, true])('descending stable records, headers=%s', (headers) => {
    const { sheet, session } = fixture([0, 1, 1, 2].map((value) => ({ kind: 'number', value })))
    sort(session, 'descending', headers)
    expect([1, 2, 3, 4].map((r) => sheet.cells.get(`B${r}`)?.value)).toEqual(
      (headers ? [0, 3, 1, 2] : [3, 1, 2, 0]).map((i) => ({ kind: 'string', value: `record-${i}` })),
    )
    if (headers) expect(sheet.cells.get('A1')?.value).toEqual({ kind: 'number', value: 0 })
  })

  it('ascending keeps header fixed and supports choosing a nonfirst column/subrange', () => {
    const { sheet, session } = fixture()
    sort(session, 'ascending', true)
    expect(sheet.cells.get('B1')?.value).toEqual({ kind: 'string', value: 'record-0' })
    expect(sheet.cells.get('B2')?.value).toEqual({ kind: 'string', value: 'record-1' })
    const outside = structuredClone(sheet.cells.get('A1'))
    session.execute({
      type: 'sort-range',
      sheetId: sheet.id,
      range: parseRangeAddress('B1:B4'),
      keyColumn: 2,
      direction: 'descending',
      headers: false,
    })
    expect(sheet.cells.get('B1')?.value).toEqual({ kind: 'string', value: 'record-3' })
    expect(sheet.cells.get('A1')).toEqual(outside)
  })

  it.each(['ascending', 'descending'] as const)(
    'documents mixed type/Polish/blank order %s without kind coercion',
    (direction) => {
      const keys: CellValue[] = [
        { kind: 'blank' },
        { kind: 'boolean', value: true },
        { kind: 'string', value: 'Żaba' },
        { kind: 'number', value: 10 },
        { kind: 'string', value: 'Łódź' },
        { kind: 'boolean', value: false },
        { kind: 'number', value: -2 },
        { kind: 'string', value: 'Lublin' },
        { kind: 'string', value: '10' },
        { kind: 'string', value: '' },
        { kind: 'string', value: 'ą' },
        { kind: 'string', value: 'a' },
      ]
      const { sheet, session } = fixture(keys)
      const before = structuredClone(sheet.cells)
      session.execute({
        type: 'sort-range',
        sheetId: sheet.id,
        range: parseRangeAddress('A1:B12'),
        keyColumn: 1,
        direction,
        headers: false,
      })
      const order =
        direction === 'ascending' ? [6, 3, 8, 11, 10, 7, 4, 2, 5, 1, 0, 9] : [1, 5, 2, 4, 7, 10, 11, 8, 3, 6, 0, 9]
      order.forEach((source, index) => {
        expect(sheet.cells.get(`A${index + 1}`)).toEqual(before.get(`A${source + 1}`))
        expect(sheet.cells.get(`B${index + 1}`)).toEqual(before.get(`B${source + 1}`))
      })
    },
  )

  it('moves absent/styled blank cells with their records and keeps unrelated cells', () => {
    const { sheet, session } = fixture()
    sheet.cells.delete('B2')
    sheet.cells.set('B3', { value: { kind: 'blank' }, style: { font: { italic: true } } })
    sheet.cells.set('Z9', { value: { kind: 'boolean', value: true } })
    sort(session)
    expect(sheet.cells.has('B1')).toBe(false)
    expect(sheet.cells.get('B2')).toEqual({ value: { kind: 'blank' }, style: { font: { italic: true } } })
    expect(sheet.cells.get('Z9')?.value).toEqual({ kind: 'boolean', value: true })
  })

  it('no-op does not dirty or create history', () => {
    const { session } = fixture([1, 2, 3, 4].map((value) => ({ kind: 'number', value })))
    expect(sort(session)).toBe(false)
    expect(session.isDirty).toBe(false)
    expect(session.historyState.undoDepth).toBe(0)
  })

  it.each([
    'formula-other-sheet',
    'merge',
    'table',
    'drawing',
    'pivot',
    'validation',
    'conditional',
    'filter',
    'note',
    'link',
    'name',
    'opaque',
    'hidden',
    'group',
    'inherited-style',
    'error',
    'date',
    'nonfinite',
  ])('refuses %s without changing cells/styles/history/dirty/events', (unsafe) => {
    const { workbook, sheet, session } = fixture()
    const range = parseRangeAddress('A1:B4')
    if (unsafe === 'formula-other-sheet') {
      const other = createWorksheet('other', 'Other')
      other.cells.set('Z9', { value: inferCellValue('=1+1', 'en') })
      workbook.sheetOrder.push(other.id)
      workbook.sheetsById.set(other.id, other)
    }
    if (unsafe === 'merge') sheet.merges.push(parseRangeAddress('B4:C4'))
    if (unsafe === 'table') sheet.tables.push({ id: 't', name: 'Table', range, columns: [] })
    if (unsafe === 'drawing') sheet.drawings.push({ id: 'd', range, kind: 'chart', preservationStatus: 'safe' })
    if (unsafe === 'pivot') sheet.pivots.push({ id: 'p', range, name: 'P', preservationStatus: 'safe' })
    if (unsafe === 'validation') sheet.validations.push({ id: 'v', range, type: 'list' })
    if (unsafe === 'conditional') sheet.conditionalFormats.push({ id: 'c', range, ruleType: 'expression' })
    if (unsafe === 'filter') sheet.autoFilter = { range }
    if (unsafe === 'note')
      sheet.comments = [{ address: 'B2', text: 'note', author: 'a', sourcePartName: 'xl/comments1.xml' }]
    if (unsafe === 'link') sheet.hyperlinks = [{ range, target: 'https://example.invalid' }]
    if (unsafe === 'name') workbook.definedNames.push({ name: 'Data', range })
    if (unsafe === 'opaque')
      workbook.preservation = {
        parts: [
          {
            partName: 'unknown',
            classification: 'preservable-opaque',
            dependsOn: ['all'],
            status: 'safe',
            unsafeReasons: [],
          },
        ],
      }
    if (unsafe === 'hidden') sheet.rowMetadata.set(2, { hidden: true })
    if (unsafe === 'group') sheet.columnMetadata.set(2, { outlineLevel: 1 })
    if (unsafe === 'inherited-style') sheet.rowMetadata.set(2, { style: { font: { bold: true } } })
    if (unsafe === 'error') sheet.cells.set('B4', { value: { kind: 'error', code: '#N/A' } })
    if (unsafe === 'date') sheet.cells.set('B4', { value: { kind: 'date', serial: 42, numberFormat: 'yyyy-mm-dd' } })
    if (unsafe === 'nonfinite') sheet.cells.set('B4', { value: { kind: 'number', value: NaN } })
    // Existing redo and a clean checkpoint must also survive refusals.
    session.setCell(sheet.id, 'Z1', { kind: 'number', value: 1 })
    session.undo()
    const before = structuredClone(workbook)
    const history = session.historyState
    const events: unknown[] = []
    session.subscribe((event) => events.push(event))
    expect(() => sort(session)).toThrow()
    expect(workbook).toEqual(before)
    expect(session.historyState).toEqual(history)
    expect(session.isDirty).toBe(false)
    expect(events).toEqual([])
  })

  it.each(['A1:B1', 'A1:B1048576', 'A0:B4', 'B4:A1', 'A1:XFE4'])('invalid range %s refuses atomically', (address) => {
    const { workbook, session } = fixture()
    const before = structuredClone(workbook)
    expect(() =>
      session.execute({
        type: 'sort-range',
        sheetId: workbook.activeSheetId,
        range: parseRangeAddress(address),
        keyColumn: 1,
        direction: 'ascending',
        headers: false,
      }),
    ).toThrow()
    expect(workbook).toEqual(before)
    expect(session.historyState.undoDepth).toBe(0)
    expect(session.isDirty).toBe(false)
  })

  it('invalid key/header-only/history-budget refusal stays atomic', () => {
    const { workbook, sheet, session } = fixture()
    const before = structuredClone(workbook)
    for (const keyColumn of [0, 3, 1.5, NaN])
      expect(() =>
        session.execute({
          type: 'sort-range',
          sheetId: sheet.id,
          range: parseRangeAddress('A1:B4'),
          keyColumn,
          direction: 'ascending',
          headers: false,
        }),
      ).toThrow()
    expect(() =>
      session.execute({
        type: 'sort-range',
        sheetId: sheet.id,
        range: parseRangeAddress('A1:B2'),
        keyColumn: 1,
        direction: 'ascending',
        headers: true,
      }),
    ).toThrow()
    expect(() => sort(new WorkbookSession(workbook, { historyBudgetBytes: 1 }))).toThrow(/history/)
    expect(workbook).toEqual(before)
    expect(session.isDirty).toBe(false)
  })

  it.each([tableAndNoteFixture, preservationFixture])(
    'refuses imported unsafe dependencies before preservation invalidation',
    async (bytes) => {
      const parsed = await parseXlsxWorkbook('unsafe.xlsx', bytes())
      const workbook = parsed.workbook!
      const before = structuredClone(workbook)
      expect(() => sort(new WorkbookSession(workbook))).toThrow()
      expect(structuredClone(workbook)).toEqual(before)
    },
  )

  it('exports and freshly imports sorted complete styles and kinds', async () => {
    const { session, sheet } = fixture()
    sort(session)
    const result = await exportXlsxWorkbook(session.workbook)
    expect(result.report.canSave).toBe(true)
    const parsed = await parseXlsxWorkbook('sorted.xlsx', result.bytes!)
    const reopened = parsed.workbook!.sheetsById.get(parsed.workbook!.activeSheetId)!
    // Existing importer flags theme/indexed colors as at-risk; PP04 must retain that refusal.
    expect(() => sort(new WorkbookSession(parsed.workbook!), 'descending')).toThrow(/dependencies/)
    for (const [address, cell] of sheet.cells) {
      expect(reopened.cells.get(address)?.value).toEqual(cell.value)
      if (cell.style) {
        expect(reopened.cells.get(address)?.style?.font?.bold).toBe(cell.style.font?.bold || undefined)
        expect(reopened.cells.get(address)?.style?.fill?.color).toBe(cell.style.fill?.color)
      }
    }
  })
})
