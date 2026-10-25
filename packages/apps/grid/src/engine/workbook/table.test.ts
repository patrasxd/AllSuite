import { describe, expect, it } from 'vitest'
import { createWorkbook, WorkbookSession } from './index'
import { parseRangeAddress } from './address'
import type { WorkbookAction } from './commands'
import { exportXlsxWorkbook } from '../xlsx/export'
import { parseXlsxWorkbook } from '../xlsx/import'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { tableAndNoteFixture, threadedFixture } from '../xlsx/fixtures/safety-corpus'
import { DOMParser } from '@xmldom/xmldom'

const range = parseRangeAddress('A1:B3')
function fixture() {
  const workbook = createWorkbook()
  const session = new WorkbookSession(workbook)
  const sheet = workbook.sheetsById.get(workbook.activeSheetId)!
  session.setCells(
    sheet.id,
    ['Name\tTeam', 'Anna\tA', 'Bob\tB'].flatMap((line, r) =>
      line
        .split('\t')
        .map((value, c) => ({ address: `${c ? 'B' : 'A'}${r + 1}`, value: { kind: 'string' as const, value } })),
    ),
  )
  session.markSaved(session.createSaveCheckpoint())
  return { workbook, session, sheet }
}
function create(session: WorkbookSession, name = 'Records') {
  session.execute({ type: 'create-table', sheetId: session.workbook.activeSheetId, range, name } as WorkbookAction)
}
describe('PP06 native tables', () => {
  it('refuses invalid XML body literals before mutation', () => {
    const { session, workbook, sheet } = fixture()
    session.setCell(sheet.id, 'A2', { kind: 'string', value: '\u0001bad' })
    const before = structuredClone(workbook)
    expect(() => create(session)).toThrow()
    expect(workbook).toEqual(before)
  })
  it('history budget rejection leaves model dirty state and history unchanged', () => {
    const { workbook } = fixture()
    const session = new WorkbookSession(workbook, { historyBudgetBytes: 1 })
    const before = structuredClone(workbook)
    const history = session.historyState
    expect(() => create(session)).toThrow(/history/)
    expect(workbook).toEqual(before)
    expect(session.historyState).toEqual(history)
    expect(session.isDirty).toBe(false)
  })
  it.each(['merge', 'filter', 'formula', 'unsafe'])('refuses conflicting %s metadata before mutation', (kind) => {
    const { workbook, sheet, session } = fixture()
    if (kind === 'merge') sheet.merges = [parseRangeAddress('A2:B2')]
    if (kind === 'filter') sheet.autoFilter = { range, criteria: [] }
    if (kind === 'formula')
      session.setCell(sheet.id, 'G9', {
        kind: 'formula',
        formula: {
          source: '=1',
          canonicalExpression: '=1',
          ast: null,
          cachedResult: { kind: 'number', value: 1 },
          calculationStatus: 'fresh',
        },
      })
    if (kind === 'unsafe') workbook.formulaStructureUnsafe = true
    const before = structuredClone(workbook)
    const history = session.historyState
    expect(() => create(session)).toThrow()
    expect(workbook).toEqual(before)
    expect(session.historyState).toEqual(history)
  })
  it.each(['', ' ', 'A1', 'R1C1', 'C', '1Table', 'Has space', 'a.b', 'x'.repeat(256)])(
    'atomically refuses invalid table name %s',
    (name) => {
      const { session, workbook } = fixture()
      const before = structuredClone(workbook)
      const history = session.historyState
      expect(() => create(session, name)).toThrow()
      expect(workbook).toEqual(before)
      expect(session.historyState).toEqual(history)
      expect(session.isDirty).toBe(false)
    },
  )
  it.each([
    { kind: 'blank' as const },
    { kind: 'number' as const, value: 3 },
    { kind: 'string' as const, value: '' },
    { kind: 'string' as const, value: ' ' },
    { kind: 'string' as const, value: 'name' },
    { kind: 'string' as const, value: '\u0001bad' },
  ])('refuses blank, nontext, duplicate and invalid headers: %j', (value) => {
    const { session, workbook, sheet } = fixture()
    session.setCell(sheet.id, 'B1', value)
    const before = structuredClone(workbook)
    const history = session.historyState
    expect(() => create(session)).toThrow()
    expect(workbook).toEqual(before)
    expect(session.historyState).toEqual(history)
  })
  it.each(['A1:B1', 'A1:XFD3', 'A1:B1048577'])('refuses invalid range %s atomically', (reference) => {
    const { session, workbook } = fixture()
    const before = structuredClone(workbook)
    expect(() =>
      session.execute({
        type: 'create-table',
        sheetId: workbook.activeSheetId,
        name: 'Records',
        range: parseRangeAddress(reference),
      }),
    ).toThrow()
    expect(workbook).toEqual(before)
  })
  it('refuses overlapping tables and duplicate names across sheets', () => {
    const { session, workbook, sheet } = fixture()
    create(session)
    const before = structuredClone(workbook)
    expect(() => create(session, 'Other')).toThrow()
    expect(workbook).toEqual(before)
    const other = structuredClone(sheet)
    other.id = 'second'
    other.tables = []
    other.autoFilter = undefined
    workbook.sheetsById.set(other.id, other)
    workbook.sheetOrder.push(other.id)
    expect(() => session.execute({ type: 'create-table', sheetId: other.id, range, name: 'records' })).toThrow()
  })
  it('supports independent native IDs on different sheets', async () => {
    const { session, workbook, sheet } = fixture()
    create(session)
    const other = structuredClone(sheet)
    other.id = 'second'
    other.name = 'Second'
    other.tables = []
    other.autoFilter = undefined
    workbook.sheetsById.set(other.id, other)
    workbook.sheetOrder.push(other.id)
    session.execute({ type: 'create-table', sheetId: other.id, range, name: 'Other' })
    expect(other.tables[0].nativeId).toBe(2)
    const saved = await exportXlsxWorkbook(workbook, 'two.xlsx')
    expect(saved.report.canSave).toBe(true)
    const parts = unzipSync(saved.bytes!)
    expect(Object.keys(parts).filter((p) => /^xl\/tables\/table\d+\.xml$/.test(p))).toHaveLength(2)
  })
  it('body editing and filtering preserve cell kinds/styles and manual hiding through conversion history', () => {
    const { session, sheet } = fixture()
    session.formatCells(sheet.id, [{ address: 'B2', style: { font: { bold: true }, fill: { color: '#FF0000' } } }])
    session.setRowMetadata(sheet.id, 2, { hidden: true })
    create(session)
    session.execute({
      type: 'set-auto-filter',
      sheetId: sheet.id,
      range,
      criteria: [{ column: 1, values: ['Anna'], blank: false }],
    })
    expect(sheet.rowMetadata.get(3)?.filterHidden).toBe(true)
    expect(sheet.rowMetadata.get(1)?.filterHidden).toBeUndefined()
    session.setCell(sheet.id, 'B2', { kind: 'number', value: 7 })
    const cells = structuredClone(sheet.cells)
    const table = structuredClone(sheet.tables)
    expect(() => session.setCell(sheet.id, 'A1', { kind: 'string', value: 'New' })).toThrow()
    session.execute({ type: 'convert-table', sheetId: sheet.id, tableId: sheet.tables[0].id })
    expect(sheet.cells).toEqual(cells)
    expect(sheet.tables).toEqual([])
    expect(sheet.rowMetadata.get(2)?.hidden).toBe(true)
    expect(sheet.rowMetadata.get(3)?.filterHidden).toBeUndefined()
    session.undo()
    expect(sheet.tables).toEqual(table)
    expect(sheet.rowMetadata.get(3)?.filterHidden).toBe(true)
    session.redo()
    expect(sheet.cells).toEqual(cells)
    expect(sheet.tables).toEqual([])
  })
  it('reopens filtered table, edits body, clears and converts without orphan parts or loss of original styles', async () => {
    const { session, workbook, sheet } = fixture()
    session.setRowMetadata(sheet.id, 2, { hidden: true })
    session.formatCells(sheet.id, [{ address: 'B3', style: { font: { bold: true }, fill: { color: '#FF0000' } } }])
    create(session)
    session.execute({
      type: 'set-auto-filter',
      sheetId: sheet.id,
      range,
      criteria: [{ column: 1, values: ['Anna'], blank: false }],
    })
    const saved = await exportXlsxWorkbook(workbook, 'table.xlsx')
    expect(saved.report.canSave, JSON.stringify(saved.report)).toBe(true)
    const parts = unzipSync(saved.bytes!)
    expect(strFromU8(parts['xl/tables/table1.xml'])).toContain('<filter val="Anna"')
    expect(strFromU8(parts['xl/worksheets/sheet1.xml'])).not.toContain('<autoFilter')
    parts['xl/styles.xml'] = strToU8(
      strFromU8(parts['xl/styles.xml'])
        .replace(/theme="1"/g, 'rgb="FF000000"')
        .replace(/indexed="64"/g, 'rgb="FF000000"'),
    )
    const reopened = (await parseXlsxWorkbook('table.xlsx', zipSync(parts))).workbook!
    const s = new WorkbookSession(reopened)
    const sh = reopened.sheetsById.get(reopened.activeSheetId)!
    expect(sh.tables[0].ownership).toBe('simple')
    expect(sh.rowMetadata.get(2)?.hidden).toBe(true)
    expect(sh.rowMetadata.get(3)?.filterHidden).toBe(true)
    s.execute({ type: 'set-auto-filter', sheetId: sh.id, range, criteria: [] })
    expect(sh.rowMetadata.get(2)?.hidden).toBe(true)
    expect(sh.rowMetadata.get(3)?.filterHidden).toBeUndefined()
    s.setCell(sh.id, 'B3', { kind: 'number', value: 9 })
    const edited = await exportXlsxWorkbook(reopened, 'edited.xlsx')
    expect(edited.report.canSave, JSON.stringify(edited.report)).toBe(true)
    const data = structuredClone(sh.cells)
    s.execute({ type: 'convert-table', sheetId: sh.id, tableId: sh.tables[0].id })
    const converted = await exportXlsxWorkbook(reopened, 'plain.xlsx')
    expect(converted.report.canSave, JSON.stringify(converted.report)).toBe(true)
    const out = unzipSync(converted.bytes!)
    expect(out['xl/tables/table1.xml']).toBeUndefined()
    expect(out['xl/worksheets/_rels/sheet1.xml.rels']).toBeUndefined()
    expect(strFromU8(out['[Content_Types].xml'])).not.toContain('spreadsheetml.table+xml')
    expect(strFromU8(out['xl/worksheets/sheet1.xml'])).not.toContain('tableParts')
    expect(sh.cells).toEqual(data)
    const final = (await parseXlsxWorkbook('plain.xlsx', converted.bytes!)).workbook!
    expect(final.sheetsById.get(final.activeSheetId)!.cells).toEqual(data)
    s.undo()
    expect((await exportXlsxWorkbook(reopened, 'undo.xlsx')).report.canSave).toBe(true)
    s.redo()
    expect((await exportXlsxWorkbook(reopened, 'redo.xlsx')).report.canSave).toBe(true)
  })
  it.each([tableAndNoteFixture, threadedFixture])(
    'retains protected imported objects and refuses table authoring',
    async (make) => {
      const imported = (await parseXlsxWorkbook('protected.xlsx', make())).workbook!
      const session = new WorkbookSession(imported)
      const before = structuredClone(imported)
      expect(() => create(session)).toThrow()
      expect(structuredClone(imported)).toEqual(before)
      const saved = await exportXlsxWorkbook(imported, 'unchanged.xlsx')
      expect(saved.bytes).toEqual(imported.preservation!.originalArchiveBytes)
      const sheet = imported.sheetsById.get(imported.activeSheetId)!
      if (sheet.tables.length)
        expect(() =>
          session.execute({ type: 'convert-table', sheetId: sheet.id, tableId: sheet.tables[0].id }),
        ).toThrow()
    },
  )
  it.each([' totalsRowCount="1"', ' custom="unknown"'])(
    'never grants ownership to an unsupported native table extension %s',
    async (extension) => {
      const { session, workbook } = fixture()
      create(session)
      const parts = unzipSync((await exportXlsxWorkbook(workbook, 'table.xlsx')).bytes!)
      parts['xl/tables/table1.xml'] = strToU8(
        strFromU8(parts['xl/tables/table1.xml']).replace('<table ', `<table${extension} `),
      )
      const bytes = zipSync(parts)
      const imported = (await parseXlsxWorkbook('complex.xlsx', bytes)).workbook!
      const sh = imported.sheetsById.get(imported.activeSheetId)!
      expect(sh.tables[0].ownership).toBeUndefined()
      const s = new WorkbookSession(imported)
      s.setCell(sh.id, 'A1', { kind: 'string', value: 'Changed' })
      expect((await exportXlsxWorkbook(imported, 'unsafe.xlsx')).report.canSave).toBe(false)
      s.undo()
      expect((await exportXlsxWorkbook(imported, 'safe.xlsx')).bytes).toEqual(bytes)
    },
  )
  it('creates real metadata in one undoable operation without changing cells', () => {
    const { session, sheet } = fixture()
    const cells = structuredClone(sheet.cells)
    create(session)
    expect(sheet.tables).toHaveLength(1)
    expect(sheet.tables[0]).toMatchObject({
      name: 'Records',
      range,
      columns: [
        { id: '1', name: 'Name' },
        { id: '2', name: 'Team' },
      ],
    })
    expect(sheet.cells).toEqual(cells)
    session.undo()
    expect(sheet.tables).toEqual([])
    session.redo()
    expect(sheet.tables).toHaveLength(1)
  })
  it('writes native parts and fresh imports editable table semantics', async () => {
    const { session, workbook } = fixture()
    create(session)
    const saved = await exportXlsxWorkbook(workbook, 'table.xlsx')
    expect(saved.report.canSave).toBe(true)
    const parts = unzipSync(saved.bytes!)
    expect(strFromU8(parts['xl/tables/table1.xml'])).toContain('displayName="Records"')
    expect(strFromU8(parts['xl/worksheets/sheet1.xml'])).toContain('tableParts')
    expect(strFromU8(parts['xl/worksheets/_rels/sheet1.xml.rels'])).toContain('/table"')
    expect(strFromU8(parts['[Content_Types].xml'])).toContain('spreadsheetml.table+xml')
    const xml = new DOMParser().parseFromString(strFromU8(parts['xl/tables/table1.xml']), 'application/xml')
    expect(xml.documentElement!.namespaceURI).toBe('http://schemas.openxmlformats.org/spreadsheetml/2006/main')
    expect(xml.documentElement!.getAttribute('id')).toBe('1')
    expect(xml.getElementsByTagName('tableColumn').length).toBe(2)
    const rels = new DOMParser().parseFromString(
      strFromU8(parts['xl/worksheets/_rels/sheet1.xml.rels']),
      'application/xml',
    )
    const relationships = Array.from(rels.getElementsByTagName('Relationship'))
    expect(relationships).toHaveLength(1)
    const worksheet = new DOMParser().parseFromString(strFromU8(parts['xl/worksheets/sheet1.xml']), 'application/xml')
    expect(
      worksheet
        .getElementsByTagName('tablePart')[0]
        .getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'),
    ).toBe(relationships[0].getAttribute('Id'))
    const types = new DOMParser().parseFromString(strFromU8(parts['[Content_Types].xml']), 'application/xml')
    expect(
      Array.from(types.getElementsByTagName('Override')).filter(
        (n) => n.getAttribute('PartName') === '/xl/tables/table1.xml',
      ),
    ).toHaveLength(1)
    const imported = await parseXlsxWorkbook('table.xlsx', saved.bytes!)
    expect(imported.workbook!.sheetsById.get(imported.workbook!.activeSheetId)!.tables[0]).toMatchObject({
      name: 'Records',
      ownership: 'simple',
    })
    const reopenedSession = new WorkbookSession(imported.workbook!)
    reopenedSession.setCell(imported.workbook!.activeSheetId, 'B2', { kind: 'number', value: 12 })
    expect((await exportXlsxWorkbook(imported.workbook!, 'edited-native.xlsx')).report.canSave).toBe(true)
  })
  it('round trips XML-sensitive and Polish headers without changing literal values', async () => {
    const { workbook, sheet, session } = fixture()
    session.setCell(sheet.id, 'A1', { kind: 'string', value: 'Imię & <"żółć">' })
    session.setCell(sheet.id, 'B1', { kind: 'string', value: 'Dane 😀' })
    create(session)
    const saved = await exportXlsxWorkbook(workbook, 'unicode.xlsx')
    expect(saved.report.canSave).toBe(true)
    const imported = (await parseXlsxWorkbook('unicode.xlsx', saved.bytes!)).workbook!
    expect(imported.sheetsById.get(imported.activeSheetId)!.tables[0].columns.map((c) => c.name)).toEqual([
      'Imię & <"żółć">',
      'Dane 😀',
    ])
  })
  it('keeps out-of-schema native IDs read-only', async () => {
    const { workbook, session } = fixture()
    create(session)
    const parts = unzipSync((await exportXlsxWorkbook(workbook, 'table.xlsx')).bytes!)
    parts['xl/tables/table4294967296.xml'] = strToU8(
      strFromU8(parts['xl/tables/table1.xml']).replace('id="1"', 'id="4294967296"'),
    )
    delete parts['xl/tables/table1.xml']
    for (const path of ['xl/worksheets/_rels/sheet1.xml.rels', '[Content_Types].xml'])
      parts[path] = strToU8(strFromU8(parts[path]).replace('table1.xml', 'table4294967296.xml'))
    const imported = (await parseXlsxWorkbook('invalid.xlsx', zipSync(parts))).workbook!
    expect(imported.sheetsById.get(imported.activeSheetId)!.tables[0].ownership).toBeUndefined()
  })
  it.each([
    'relationship-type',
    'duplicate-tableParts',
    'extra-tablePart-attribute',
    'advanced-filter',
    'table-extension',
    'relationship-extension',
    'content-type-extension',
  ])('does not grant ownership to unsupported graph or grammar: %s', async (kind) => {
    const { workbook, session } = fixture()
    create(session)
    const saved = await exportXlsxWorkbook(workbook, 'table.xlsx')
    const parts = unzipSync(saved.bytes!)
    const sheetPath = 'xl/worksheets/sheet1.xml'
    const relPath = 'xl/worksheets/_rels/sheet1.xml.rels'
    const tablePath = 'xl/tables/table1.xml'
    if (kind === 'relationship-type')
      parts[relPath] = strToU8(
        strFromU8(parts[relPath]).replace(
          'http://schemas.openxmlformats.org/officeDocument/2006/relationships/table',
          'urn:unknown/table',
        ),
      )
    if (kind === 'duplicate-tableParts')
      parts[sheetPath] = strToU8(
        strFromU8(parts[sheetPath]).replace(
          '</worksheet>',
          '<tableParts count="1"><tablePart r:id="rIdTable1"/></tableParts></worksheet>',
        ),
      )
    if (kind === 'extra-tablePart-attribute') {
      parts[sheetPath] = strToU8(
        strFromU8(parts[sheetPath]).replace(/<tablePart(?=[\s>])/, '<tablePart custom="opaque"'),
      )
      expect(strFromU8(parts[sheetPath])).toContain('custom="opaque"')
    }
    if (kind === 'advanced-filter')
      parts[tablePath] = strToU8(
        strFromU8(parts[tablePath]).replace(
          '<autoFilter ref="A1:B3"/>',
          '<autoFilter ref="A1:B3"><filterColumn colId="0"><top10 val="10"/></filterColumn></autoFilter>',
        ),
      )
    if (kind === 'table-extension')
      parts[tablePath] = strToU8(
        strFromU8(parts[tablePath]).replace('</table>', '<extLst><ext uri="opaque"/></extLst></table>'),
      )
    if (kind === 'relationship-extension')
      parts[relPath] = strToU8(
        strFromU8(parts[relPath]).replace('<Relationship Id=', '<Relationship custom="opaque" Id='),
      )
    if (kind === 'content-type-extension')
      parts['[Content_Types].xml'] = strToU8(
        strFromU8(parts['[Content_Types].xml']).replace(
          'PartName="/xl/tables/table1.xml"',
          'custom="opaque" PartName="/xl/tables/table1.xml"',
        ),
      )
    const bytes = zipSync(parts)
    const imported = await parseXlsxWorkbook('foreign.xlsx', bytes)
    if (imported.workbook) {
      const sh = imported.workbook.sheetsById.get(imported.workbook.activeSheetId)!
      expect(sh.tables.some((t) => t.ownership === 'simple')).toBe(false)
      const exported = await exportXlsxWorkbook(imported.workbook, 'foreign.xlsx')
      if (exported.report.canSave) expect(exported.bytes).toEqual(bytes)
      else expect(exported.bytes).toBeUndefined()
    } else expect(imported.report.canOpen).toBe(false)
  })
})
