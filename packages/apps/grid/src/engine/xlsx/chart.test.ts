import { describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { DOMParser } from '@xmldom/xmldom'
import { createWorkbook, parseRangeAddress, WorkbookSession, type Workbook } from '../workbook'
import { chartData, defaultChart, MAX_CHART_POINTS } from '../workbook/chart'
import { exportXlsxWorkbook } from './export'
import { parseXlsxWorkbook } from './import'
import { CHART_NS, DRAWING_NS, OFFICE_REL_NS } from './chart-xml'
import { tableAndNoteFixture } from './fixtures/safety-corpus'

function setup(workbook = createWorkbook({ firstSheetName: "Revenue '26" }), range = 'A1:B6') {
  const session = new WorkbookSession(workbook)
  const id = workbook.activeSheetId
  const sheet = workbook.sheetsById.get(id)!
  const rows = [
    ['Month', 'Revenue'],
    ['Jan', 120],
    ['Feb', -45],
    ['Mar', null],
    ['Apr', 0],
    ['May', 180],
  ]
  session.setCells(
    id,
    rows.flatMap((row, r) =>
      row.map((value, c) => ({
        address: `${c ? 'B' : 'A'}${r + 1}`,
        value:
          value === null
            ? { kind: 'blank' as const }
            : typeof value === 'number'
              ? { kind: 'number' as const, value }
              : { kind: 'string' as const, value },
      })),
    ),
  )
  const chart = defaultChart(sheet, parseRangeAddress(range))
  const create = () => session.execute({ type: 'set-chart', sheetId: id, chart })
  return { workbook, session, sheet, id, chart, create }
}
async function save(workbook: Workbook) {
  const output = await exportXlsxWorkbook(workbook, 'charts.xlsx')
  expect(output.report.canSave, JSON.stringify(output.report)).toBe(true)
  return output.bytes!
}
async function reopen(bytes: Uint8Array) {
  const parsed = await parseXlsxWorkbook('charts.xlsx', bytes)
  expect(parsed.report.canOpen).toBe(true)
  return parsed.workbook!
}
const xml = (parts: Record<string, Uint8Array>, path: string) =>
  new DOMParser().parseFromString(strFromU8(parts[path]), 'application/xml')

describe('one native column chart', () => {
  it('interprets headers, blanks, zero and negative values; resolves fresh changes without storing a duplicate cache', () => {
    const { sheet, chart, session, id } = setup()
    expect(chartData(sheet, chart)).toEqual({
      categoryTitle: 'Month',
      seriesTitle: 'Revenue',
      points: [
        { category: 'Jan', value: 120 },
        { category: 'Feb', value: -45 },
        { category: 'Mar', value: null },
        { category: 'Apr', value: 0 },
        { category: 'May', value: 180 },
      ],
    })
    session.setCell(id, 'B2', { kind: 'number', value: -240 })
    expect(chartData(sheet, chart).points[0].value).toBe(-240)
    session.setCell(id, 'B2', { kind: 'blank' })
    expect(chartData(sheet, chart).points[0].value).toBeNull()
  })
  it('accepts headerless data and rejects unusable, merged and oversized sources without mutation', () => {
    const { workbook, sheet, chart, session, id } = setup()
    expect(chartData(sheet, { ...chart, sourceRange: parseRangeAddress('A2:B3'), headers: false }).points).toHaveLength(
      2,
    )
    const history = session.historyState
    for (const range of ['A1:A6', 'A1:C6', 'D1:E5', `A1:B${MAX_CHART_POINTS + 2}`]) {
      expect(() =>
        session.execute({ type: 'set-chart', sheetId: id, chart: { ...chart, sourceRange: parseRangeAddress(range) } }),
      ).toThrow()
      expect(sheet.drawings).toEqual([])
      expect(session.historyState).toEqual(history)
    }
    sheet.merges.push(parseRangeAddress('A2:B2'))
    expect(() => chartData(sheet, chart)).toThrow()
    expect(workbook.sheetsById.get(id)!.drawings).toEqual([])
  })
  it('supports atomic create, title/source edit, delete, undo and redo without altering cell selection data', () => {
    const { sheet, chart, session, id, create } = setup()
    session.markClean()
    create()
    const drawing = structuredClone(sheet.drawings[0])
    expect(session.isDirty).toBe(true)
    session.undo()
    expect(sheet.drawings).toEqual([])
    expect(session.isDirty).toBe(false)
    session.redo()
    expect(sheet.drawings).toEqual([drawing])
    session.execute({
      type: 'set-chart',
      sheetId: id,
      chart: { ...chart, title: 'Updated', sourceRange: parseRangeAddress('A1:B3') },
    })
    expect(sheet.drawings[0].chart?.title).toBe('Updated')
    session.undo()
    expect(sheet.drawings[0]).toEqual(drawing)
    session.execute({ type: 'remove-chart', sheetId: id, chartId: drawing.id })
    expect(sheet.drawings).toEqual([])
    session.undo()
    expect(sheet.drawings).toEqual([drawing])
    session.redo()
    expect(sheet.drawings).toEqual([])
    expect(sheet.cells.get('B2')?.value).toEqual({ kind: 'number', value: 120 })
  })
  it('rejects stale/unsupported formula sources, updates fresh results and blocks stale native caches', async () => {
    const { sheet, chart, session, id, workbook, create } = setup()
    session.setCell(id, 'B2', {
      kind: 'formula',
      formula: {
        source: '=2*3',
        canonicalExpression: '=2*3',
        ast: null,
        cachedResult: { kind: 'number', value: 6 },
        calculationStatus: 'stale',
      },
    })
    expect(() => chartData(sheet, chart)).toThrow('stale')
    session.applyCalculationResults([
      { sheetId: id, address: 'B2', calculationStatus: 'fresh', result: { kind: 'number', value: 6 } },
    ])
    create()
    const bytes = await save(workbook)
    expect(strFromU8(unzipSync(bytes)['xl/charts/chart1.xml'])).toContain('<c:v>6</c:v>')
    session.applyCalculationResults([
      { sheetId: id, address: 'B2', calculationStatus: 'fresh', result: { kind: 'number', value: 12 } },
    ])
    expect(chartData(sheet, chart).points[0].value).toBe(12)
    const changed = await save(workbook)
    expect(strFromU8(unzipSync(changed)['xl/charts/chart1.xml'])).toContain('<c:v>12</c:v>')
    session.applyCalculationResults([{ sheetId: id, address: 'B2', calculationStatus: 'unsupported' }])
    expect((await exportXlsxWorkbook(workbook, 'bad.xlsx')).bytes).toBeUndefined()
  })
  it('serializes source formulas, sparse indexed caches, source-adjacent anchors and the native relationship/content-type graph', async () => {
    const { workbook, create } = setup()
    create()
    const bytes = await save(workbook)
    const parts = unzipSync(bytes)
    const chart = xml(parts, 'xl/charts/chart1.xml')
    expect(Array.from(chart.getElementsByTagNameNS(CHART_NS, 'f')).map((node) => node.textContent)).toEqual([
      "'Revenue ''26'!$B$1",
      "'Revenue ''26'!$A$2:$A$6",
      "'Revenue ''26'!$B$2:$B$6",
    ])
    expect(chart.getElementsByTagNameNS(CHART_NS, 'barDir')[0].getAttribute('val')).toBe('col')
    const cache = chart.getElementsByTagNameNS(CHART_NS, 'numCache')[0]
    expect(cache.getElementsByTagNameNS(CHART_NS, 'ptCount')[0].getAttribute('val')).toBe('5')
    expect(
      Array.from(cache.getElementsByTagNameNS(CHART_NS, 'pt')).map((node) => [
        node.getAttribute('idx'),
        node.textContent,
      ]),
    ).toEqual([
      ['0', '120'],
      ['1', '-45'],
      ['3', '0'],
      ['4', '180'],
    ])
    const drawing = xml(parts, 'xl/drawings/drawing1.xml')
    const marker = (name: string) =>
      Array.from(drawing.getElementsByTagNameNS(DRAWING_NS, name)[0].childNodes).map((node) => node.textContent)
    expect(marker('from')).toEqual(['3', '0', '0', '0'])
    expect(marker('to')).toEqual(['8', '0', '10', '0'])
    expect(drawing.getElementsByTagNameNS(CHART_NS, 'chart')[0].getAttributeNS(OFFICE_REL_NS, 'id')).toBe('rIdChart1')
    expect(strFromU8(parts['xl/drawings/_rels/drawing1.xml.rels'])).toContain('Target="../charts/chart1.xml"')
    expect(strFromU8(parts['xl/worksheets/_rels/sheet1.xml.rels'])).toContain('Target="../drawings/drawing1.xml"')
    const parsed = await reopen(bytes)
    expect(
      parsed.preservation!.inventory!.relationships.every((rel) => rel.targetMode === 'External' || rel.targetExists),
    ).toBe(true)
    const types = parsed.preservation!.inventory!.contentTypes
    expect(types.find((type) => type.partName === 'xl/charts/chart1.xml')?.contentType).toContain('drawingml.chart+xml')
    expect(types.find((type) => type.partName === 'xl/drawings/drawing1.xml')?.contentType).toContain('drawing+xml')
  })
  it('round trips moved and resized anchors with atomic history and retains edited title geometry', async () => {
    const { workbook, session, sheet, id, create, chart } = setup()
    create()
    const original = structuredClone(sheet.drawings[0].range)
    const move = parseRangeAddress('F4:K18'),
      resize = parseRangeAddress('F4:M22')
    const place = (range: typeof move) =>
      session.execute({ type: 'place-chart', sheetId: id, chartId: sheet.drawings[0].id, range })
    place(move)
    place(resize)
    session.undo()
    expect(sheet.drawings[0].range).toEqual(move)
    session.undo()
    expect(sheet.drawings[0].range).toEqual(original)
    session.redo()
    session.redo()
    session.execute({ type: 'set-chart', sheetId: id, chart: { ...chart, title: 'Placed chart' } })
    const parts = unzipSync(await save(workbook))
    const drawing = strFromU8(parts['xl/drawings/drawing1.xml'])
    expect(drawing).toContain('<xdr:col>5</xdr:col>')
    expect(drawing).toContain('<xdr:row>21</xdr:row>')
    const reopened = await reopen(await save(workbook))
    const actual = reopened.sheetsById.get(id) ?? reopened.sheetsById.get(reopened.activeSheetId)!
    expect(actual.drawings[0].range).toEqual({ start: { row: 4, column: 6 }, end: { row: 22, column: 13 } })
    const secondSession = new WorkbookSession(reopened)
    secondSession.execute({ type: 'place-chart', sheetId: actual.id, chartId: actual.drawings[0].id, range: move })
    expect((await reopen(await save(reopened))).sheetsById.values().next().value!.drawings[0].range).toEqual({
      start: { row: 4, column: 6 },
      end: { row: 18, column: 11 },
    })
    const before = structuredClone(sheet.drawings)
    expect(() => place(parseRangeAddress('A1:B2'))).toThrow()
    expect(sheet.drawings).toEqual(before)
  })
  it('edits, saves, reimports, removes and undoes an owned chart without orphan parts', async () => {
    const initial = setup()
    initial.create()
    const workbook = await reopen(await save(initial.workbook))
    const sheet = workbook.sheetsById.get(workbook.activeSheetId)!
    const session = new WorkbookSession(workbook)
    expect(sheet.drawings[0].chart?.title).toBe('Revenue')
    session.setCell(sheet.id, 'B2', { kind: 'number', value: 240 })
    session.execute({
      type: 'set-chart',
      sheetId: sheet.id,
      chart: { ...sheet.drawings[0].chart!, title: 'Net <revenue> & growth' },
    })
    const changed = await save(workbook)
    const fresh = await reopen(changed)
    const actual = fresh.sheetsById.get(fresh.activeSheetId)!
    expect(actual.drawings[0].chart?.title).toBe('Net <revenue> & growth')
    expect(chartData(actual, actual.drawings[0].chart!).points[0].value).toBe(240)
    session.execute({ type: 'remove-chart', sheetId: sheet.id, chartId: sheet.drawings[0].id })
    const deleted = unzipSync(await save(workbook))
    expect(Object.keys(deleted).some((path) => /\/charts\/|drawing1/.test(path))).toBe(false)
    expect(strFromU8(deleted['xl/worksheets/sheet1.xml'])).not.toContain('<drawing')
    expect(strFromU8(deleted['[Content_Types].xml'])).not.toContain('drawingml.chart')
    session.undo()
    expect((await reopen(await save(workbook))).sheetsById.values().next().value!.drawings[0].chart).toBeDefined()
  })
  it.each([
    'line',
    'shape',
    'extra-anchor',
    'one-cell',
    'offset',
    'extension',
    'relationship',
    'content-type',
    'unknown-rel-attribute',
    'shared-reference',
  ])('keeps %s variations opaque and byte-preserved through an unrelated cell edit', async (variation) => {
    const initial = setup()
    initial.create()
    const parts = unzipSync(await save(initial.workbook))
    const chartPart = 'xl/charts/chart1.xml',
      drawingPart = 'xl/drawings/drawing1.xml',
      relPart = 'xl/drawings/_rels/drawing1.xml.rels'
    const change = (path: string, fn: (text: string) => string) => {
      parts[path] = strToU8(fn(strFromU8(parts[path])))
    }
    if (variation === 'line') change(chartPart, (s) => s.replaceAll('barChart', 'lineChart'))
    if (variation === 'shared-reference')
      change('xl/worksheets/sheet1.xml', (s) =>
        s.replace(
          '</worksheet>',
          '<extLst><ext uri="vendor"><v:chartUse xmlns:v="urn:vendor" r:id="rIdDrawing1"/></ext></extLst></worksheet>',
        ),
      )
    if (variation === 'shape')
      change(drawingPart, (s) =>
        s.replace(
          /<xdr:graphicFrame[\s\S]*?<\/xdr:graphicFrame>/u,
          '<xdr:sp><xdr:nvSpPr><xdr:cNvPr id="2" name="Opaque shape"/></xdr:nvSpPr></xdr:sp>',
        ),
      )
    if (variation === 'extra-anchor')
      change(drawingPart, (s) => s.replace('</xdr:wsDr>', '<xdr:absoluteAnchor/></xdr:wsDr>'))
    if (variation === 'one-cell') change(drawingPart, (s) => s.replaceAll('twoCellAnchor', 'oneCellAnchor'))
    if (variation === 'offset')
      change(drawingPart, (s) => s.replace('<xdr:colOff>0</xdr:colOff>', '<xdr:colOff>9525</xdr:colOff>'))
    if (variation === 'extension')
      change(chartPart, (s) =>
        s.replace('</c:chartSpace>', '<c:extLst><c:ext uri="vendor"/></c:extLst></c:chartSpace>'),
      )
    if (variation === 'relationship') {
      parts['xl/charts/vendor.xml'] = strToU8('<payload/>')
      change(relPart, (s) =>
        s.replace(
          '</Relationships>',
          `<Relationship Id="extra" Type="urn:vendor" Target="../charts/vendor.xml"/></Relationships>`,
        ),
      )
    }
    if (variation === 'content-type')
      change('[Content_Types].xml', (s) => s.replace('drawingml.chart+xml', 'drawingml.chartshapes+xml'))
    if (variation === 'unknown-rel-attribute')
      change(relPart, (s) => s.replace('Id="rIdChart1"', 'Id="rIdChart1" vendor="keep"'))
    const workbook = await reopen(zipSync(parts))
    const sheet = workbook.sheetsById.get(workbook.activeSheetId)!
    expect(sheet.drawings[0]?.chart).toBeUndefined()
    const session = new WorkbookSession(workbook)
    session.setCell(sheet.id, 'D20', { kind: 'string', value: 'unrelated' })
    const saved = unzipSync(await save(workbook))
    for (const path of [chartPart, drawingPart, relPart])
      expect(Array.from(saved[path])).toEqual(Array.from(parts[path]))
    expect(strFromU8(saved['xl/worksheets/_rels/sheet1.xml.rels'])).toContain('/drawing')
    expect(() => session.execute({ type: 'set-chart', sheetId: sheet.id, chart: initial.chart })).toThrow()
    session.insertRows(sheet.id, 1, 1)
    expect((await exportXlsxWorkbook(workbook, 'blocked.xlsx')).bytes).toBeUndefined()
  })
  it('preserves native notes, VML anchors, vendor payload and other worksheets alongside a newly authored chart', async () => {
    const bytes = tableAndNoteFixture(false, true)
    const workbook = await reopen(bytes)
    workbook.activeSheetId = workbook.sheetOrder[1]
    const { create } = setup(workbook)
    create()
    const output = await save(workbook)
    const before = unzipSync(bytes),
      after = unzipSync(output)
    for (const path of [
      'xl/comments1.xml',
      'xl/drawings/vmlDrawing1.vml',
      'xl/vendor/payload.bin',
      'customXml/item1.xml',
      'xl/worksheets/_rels/sheet1.xml.rels',
      'xl/worksheets/sheet1.xml',
    ])
      expect(Array.from(after[path])).toEqual(Array.from(before[path]))
    const fresh = await reopen(output)
    expect(fresh.sheetsById.get(fresh.sheetOrder[0])!.comments?.[0].text).toBe('Check the supplier total')
    expect(fresh.sheetsById.get(fresh.sheetOrder[1])!.drawings[0].chart).toBeDefined()
  })
  it('refuses structural relocation with charts before history or model mutation', () => {
    const { workbook, session, id, create } = setup()
    create()
    const before = structuredClone(workbook),
      history = session.historyState
    expect(() => session.insertRows(id, 1, 1)).toThrow('context')
    expect(() => session.insertColumns(id, 1, 1)).toThrow('context')
    expect(() => session.renameSheet(id, 'Renamed')).toThrow('context')
    expect(workbook).toEqual(before)
    expect(session.historyState).toEqual(history)
  })
  it('keeps note/VML/vendor relationships on the same edited sheet when a chart is added and removed', async () => {
    const parts = unzipSync(tableAndNoteFixture(false, true))
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      strFromU8(parts['xl/worksheets/sheet1.xml']).replace(/<mergeCells[\s\S]*?<\/mergeCells>/u, ''),
    )
    const original = zipSync(parts)
    const workbook = await reopen(original)
    const { create, session, sheet, id } = setup(workbook)
    create()
    const bytes = await save(workbook)
    const output = unzipSync(bytes)
    for (const path of ['xl/comments1.xml', 'xl/drawings/vmlDrawing1.vml', 'xl/vendor/payload.bin'])
      expect(Array.from(output[path])).toEqual(Array.from(parts[path]))
    const fresh = await reopen(bytes)
    const rels = fresh.preservation!.inventory!.relationships.filter(
      (rel) => rel.sourcePart === 'xl/worksheets/sheet1.xml',
    )
    for (const id of ['comments1', 'vml1', 'vendorPayload'])
      expect(rels.find((rel) => rel.id === id)).toEqual(
        workbook.preservation!.inventory!.relationships.find((rel) => rel.id === id),
      )
    expect(strFromU8(output['xl/worksheets/sheet1.xml'])).toContain('legacyDrawing r:id="vml1"')
    session.execute({ type: 'remove-chart', sheetId: id, chartId: sheet.drawings[0].id })
    const removed = await reopen(await save(workbook))
    expect(removed.sheetsById.get(removed.sheetOrder[0])!.comments?.[0].text).toBe('Check the supplier total')
  })
})
