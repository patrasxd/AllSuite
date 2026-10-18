import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { WorkbookSession, createWorkbook } from '../workbook'
import { inferCellValue } from '../editing/cell-input'
import { parseXlsxWorkbook } from './import'
import { exportXlsxWorkbook } from './export'

const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const packageRel = 'http://schemas.openxmlformats.org/package/2006/relationships'
const contentTypes = 'http://schemas.openxmlformats.org/package/2006/content-types'

function preservationFixture(): Uint8Array {
  // The test fixture is intentionally assembled as OOXML parts instead of using an XLSX writer.
  // This makes unknown parts and relationships visible to the preservation assertions.
  return zipSyncParts({
    '[Content_Types].xml': `<Types xmlns="${contentTypes}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/customXml/item1.xml" ContentType="application/xml"/></Types>`,
    '_rels/.rels': `<Relationships xmlns="${packageRel}"><Relationship Id="root" Type="${rel}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="custom" Type="${rel}/customXml" Target="customXml/item1.xml"/></Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="${main}" xmlns:r="${rel}"><workbookPr date1904="1"/><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="First" sheetId="1" r:id="rId1"/><sheet name="Second" sheetId="2" r:id="rId2"/></sheets><calcPr calcMode="auto"/></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${packageRel}"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `<styleSheet xmlns="${main}"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.00"/></numFmts><fonts count="1"><font/></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="${main}"><sheetFormatPr defaultRowHeight="18" defaultColWidth="9"/><cols><col min="2" max="2" width="20" customWidth="1"/></cols><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Text</t></is></c><c r="B1" s="1"><v>12.5</v></c><c r="C1"><f>SUM(B2,2)</f><v>7</v></c></row><row r="2"><c r="B2"><v>5</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="A3:B3"/></mergeCells></worksheet>`,
    'xl/worksheets/sheet2.xml': `<worksheet xmlns="${main}"><sheetData><row r="1"><c r="A1" t="b"><v>1</v></c></row></sheetData></worksheet>`,
    'customXml/item1.xml': '<vendorPayload version="3"><opaque>keep these exact bytes</opaque></vendorPayload>',
  })
}

function zipSyncParts(parts: Record<string, string>): Uint8Array {
  return importZipSync(Object.fromEntries(Object.entries(parts).map(([name, text]) => [name, strToU8(text)])))
}

function editFixturePart(bytes: Uint8Array, partName: string, update: (xml: string) => string): Uint8Array {
  const parts = unzipSync(bytes)
  parts[partName] = strToU8(update(strFromU8(parts[partName])))
  return zipSync(parts)
}

function editFixtureWorksheet(bytes: Uint8Array, update: (xml: string) => string): Uint8Array {
  return editFixturePart(bytes, 'xl/worksheets/sheet1.xml', update)
}

function chartPivotFixture(): Uint8Array {
  const parts = unzipSync(preservationFixture())
  const contentTypeEntries = [
    ['xl/drawings/drawing1.xml', 'application/vnd.openxmlformats-officedocument.drawing+xml'],
    ['xl/charts/chart1.xml', 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml'],
    ['xl/pivotTables/pivotTable1.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml'],
    [
      'xl/pivotCache/pivotCacheDefinition1.xml',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml',
    ],
    [
      'xl/pivotCache/pivotCacheRecords1.xml',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml',
    ],
  ]
  parts['[Content_Types].xml'] = strToU8(
    strFromU8(parts['[Content_Types].xml']).replace(
      '</Types>',
      `${contentTypeEntries.map(([part, type]) => `<Override PartName="/${part}" ContentType="${type}"/>`).join('')}</Types>`,
    ),
  )
  parts['xl/workbook.xml'] = strToU8(
    strFromU8(parts['xl/workbook.xml']).replace(
      '</workbook>',
      '<pivotCaches><pivotCache cacheId="1" r:id="pivotCache1"/></pivotCaches></workbook>',
    ),
  )
  parts['xl/_rels/workbook.xml.rels'] = strToU8(
    strFromU8(parts['xl/_rels/workbook.xml.rels']).replace(
      '</Relationships>',
      `<Relationship Id="pivotCache1" Type="${rel}/pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition1.xml"/></Relationships>`,
    ),
  )
  parts['xl/worksheets/sheet1.xml'] = strToU8(
    strFromU8(parts['xl/worksheets/sheet1.xml'])
      .replace(`<worksheet xmlns="${main}">`, `<worksheet xmlns="${main}" xmlns:r="${rel}">`)
      .replace(
        '</worksheet>',
        '<drawing r:id="drawing1"/><pivotTableParts count="1"><pivotTablePart r:id="pivot1"/></pivotTableParts></worksheet>',
      ),
  )
  parts['xl/worksheets/_rels/sheet1.xml.rels'] = strToU8(
    `<Relationships xmlns="${packageRel}"><Relationship Id="drawing1" Type="${rel}/drawing" Target="../drawings/drawing1.xml"/><Relationship Id="pivot1" Type="${rel}/pivotTable" Target="../pivotTables/pivotTable1.xml"/></Relationships>`,
  )
  parts['xl/drawings/drawing1.xml'] = strToU8(
    `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${rel}"><xdr:graphicFrame><xdr:graphic><a:graphicData><c:chart r:id="chart1"/></a:graphicData></xdr:graphic></xdr:graphicFrame></xdr:wsDr>`,
  )
  parts['xl/drawings/_rels/drawing1.xml.rels'] = strToU8(
    `<Relationships xmlns="${packageRel}"><Relationship Id="chart1" Type="${rel}/chart" Target="../charts/chart1.xml"/></Relationships>`,
  )
  parts['xl/charts/chart1.xml'] = strToU8(
    '<chartSpace xmlns="http://schemas.openxmlformats.org/drawingml/2006/chart"/>',
  )
  parts['xl/pivotTables/pivotTable1.xml'] = strToU8(
    `<pivotTableDefinition xmlns="${main}" name="PivotOne" cacheId="1"><location ref="E1:G5"/></pivotTableDefinition>`,
  )
  parts['xl/pivotCache/pivotCacheDefinition1.xml'] = strToU8(
    `<pivotCacheDefinition xmlns="${main}" cacheId="1" r:id="pivotRecords1" xmlns:r="${rel}"><cacheSource type="worksheet"><worksheetSource ref="A1:C2" sheet="First"/></cacheSource></pivotCacheDefinition>`,
  )
  parts['xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels'] = strToU8(
    `<Relationships xmlns="${packageRel}"><Relationship Id="pivotRecords1" Type="${rel}/pivotCacheRecords" Target="pivotCacheRecords1.xml"/></Relationships>`,
  )
  parts['xl/pivotCache/pivotCacheRecords1.xml'] = strToU8(
    `<pivotCacheRecords xmlns="${main}" count="1"><r><n v="5"/></r></pivotCacheRecords>`,
  )
  return zipSync(parts)
}

function importZipSync(parts: Record<string, Uint8Array>): Uint8Array {
  return zipSync(parts)
}

async function openFixture() {
  const bytes = preservationFixture()
  const result = await parseXlsxWorkbook('source.xlsx', bytes)
  if (!result.workbook) throw new Error('Fixture failed import preflight.')
  return { bytes, workbook: result.workbook }
}

describe('Grid conservative XLSX export', () => {
  it('reports unknown worksheet XML as at risk even when the worksheet also contains formulas', async () => {
    const bytes = editFixtureWorksheet(preservationFixture(), (xml) =>
      xml.replace('</worksheet>', '<vendor:payload xmlns:vendor="urn:vendor">keep</vendor:payload></worksheet>'),
    )
    const opened = await parseXlsxWorkbook('mixed.xlsx', bytes)
    expect(opened.report.canOpen).toBe(true)
    new WorkbookSession(opened.workbook!).setCell(opened.workbook!.activeSheetId, 'A1', {
      kind: 'string',
      value: 'edited',
    })
    const output = await exportXlsxWorkbook(opened.workbook!, 'mixed.xlsx')
    expect(output.report.canSave).toBe(true)
    expect(output.report.entries).toContainEqual({
      category: 'at-risk',
      code: 'unsafe-part-preserved',
      partName: 'xl/worksheets/sheet1.xml',
    })
    expect(strFromU8(unzipSync(output.bytes!)['xl/worksheets/sheet1.xml'])).toContain('vendor:payload')
  })

  it('round-trips new date formats, names, links, filters, panes and print properties', async () => {
    const workbook = createWorkbook({ firstSheetName: 'Data sheet' })
    workbook.dateSystem = '1904'
    const sheet = workbook.sheetsById.get(workbook.activeSheetId)!
    const range = { start: { row: 1, column: 1 }, end: { row: 2, column: 2 } }
    new WorkbookSession(workbook).setCell(sheet.id, 'A1', { kind: 'date', serial: 0, numberFormat: 'yyyy-mm-dd' })
    sheet.frozenPane = { xSplit: 1, ySplit: 1, topLeftCell: 'B2', state: 'frozen' }
    sheet.hyperlinks = [{ range, target: 'https://example.invalid/', targetMode: 'External', tooltip: 'inert link' }]
    sheet.autoFilter = { range }
    sheet.printSettings = {
      pageMargins: { left: 0.5, right: 0.5 },
      pageSetup: { orientation: 'landscape' },
      fitToPage: true,
    }
    workbook.definedNames.push({ name: 'DataRange', targetSheetId: sheet.id, range })
    const output = await exportXlsxWorkbook(workbook, 'features.xlsx')
    expect(output.report.canSave, JSON.stringify(output.report)).toBe(true)
    const reopened = await parseXlsxWorkbook('features.xlsx', output.bytes!)
    expect(reopened.report.canOpen).toBe(true)
    const actual = reopened.workbook!.sheetsById.get(reopened.workbook!.activeSheetId)!
    expect(actual.cells.get('A1')?.value).toMatchObject({ kind: 'date', serial: 0, numberFormat: 'yyyy-mm-dd' })
    expect(actual.frozenPane).toMatchObject(sheet.frozenPane)
    expect(actual.hyperlinks?.[0]).toMatchObject(sheet.hyperlinks[0])
    expect(actual.autoFilter?.range).toMatchObject(range)
    expect(actual.printSettings).toMatchObject(sheet.printSettings)
    expect(reopened.workbook!.definedNames[0]).toMatchObject({ name: 'DataRange', range })
  })

  it('removes a known calculation chain after edits but blocks unknown chain extensions', async () => {
    const parts = unzipSync(preservationFixture())
    parts['xl/calcChain.xml'] = strToU8(`<calcChain xmlns="${main}"><c r="C1" i="1"/></calcChain>`)
    parts['xl/_rels/workbook.xml.rels'] = strToU8(
      strFromU8(parts['xl/_rels/workbook.xml.rels']).replace(
        '</Relationships>',
        `<Relationship Id="chain" Type="${rel}/calcChain" Target="calcChain.xml"/></Relationships>`,
      ),
    )
    parts['[Content_Types].xml'] = strToU8(
      strFromU8(parts['[Content_Types].xml']).replace(
        '</Types>',
        '<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/></Types>',
      ),
    )
    const bytes = zipSync(parts)
    const opened = await parseXlsxWorkbook('chain.xlsx', bytes)
    expect(opened.report.canOpen).toBe(true)
    const untouched = await exportXlsxWorkbook(opened.workbook!, 'chain.xlsx')
    expect(untouched.bytes).toEqual(bytes)
    new WorkbookSession(opened.workbook!).setCell(opened.workbook!.activeSheetId, 'B2', { kind: 'number', value: 9 })
    const output = await exportXlsxWorkbook(opened.workbook!, 'chain.xlsx')
    expect(output.report.canSave, JSON.stringify(output.report)).toBe(true)
    const result = unzipSync(output.bytes!)
    expect(result['xl/calcChain.xml']).toBeUndefined()
    expect(strFromU8(result['xl/_rels/workbook.xml.rels'])).not.toContain('/calcChain')
    expect(strFromU8(result['[Content_Types].xml'])).not.toContain('/xl/calcChain.xml')
    const unknown = await parseXlsxWorkbook(
      'extended.xlsx',
      editFixturePart(bytes, 'xl/calcChain.xml', (xml) => xml.replace('</calcChain>', '<extLst/></calcChain>')),
    )
    new WorkbookSession(unknown.workbook!).setCell(unknown.workbook!.activeSheetId, 'B2', { kind: 'number', value: 9 })
    const blocked = await exportXlsxWorkbook(unknown.workbook!, 'extended.xlsx')
    expect(blocked.report.canSave).toBe(false)
    expect(blocked.bytes).toBeUndefined()
  })

  it('returns an untouched workbook byte for byte and preserves its part inventory', async () => {
    const { bytes, workbook } = await openFixture()
    const output = await exportXlsxWorkbook(workbook, 'source.xlsx')
    expect(output.report.canSave, JSON.stringify(output.report)).toBe(true)
    expect(output.report.requiresSaveAs).toBe(false)
    expect(output.bytes).toEqual(bytes)
    expect(Object.keys(unzipSync(output.bytes!)).sort()).toEqual(Object.keys(unzipSync(bytes)).sort())
  })

  it('edits a cell while retaining unknown part bytes and round-trips formulas, styles, merges and date mode', async () => {
    const { bytes, workbook } = await openFixture()
    const session = new WorkbookSession(workbook)
    session.setCell('xlsx-sheet-1', 'B2', { kind: 'number', value: 8 })
    session.merge('xlsx-sheet-1', 'C3:D3')
    const output = await exportXlsxWorkbook(session.workbook, 'source.xlsx')
    expect(output.report.canSave).toBe(true)
    expect(output.report.requiresSaveAs).toBe(true)
    expect(
      output.report.entries.some((entry) => entry.partName === 'customXml/item1.xml' && entry.category === 'at-risk'),
    ).toBe(true)
    const originalParts = unzipSync(bytes)
    const exportedParts = unzipSync(output.bytes!)
    expect(exportedParts['customXml/item1.xml']).toEqual(originalParts['customXml/item1.xml'])
    expect(Object.keys(exportedParts).sort()).toEqual(Object.keys(originalParts).sort())
    const reopened = await parseXlsxWorkbook('round-trip.xlsx', output.bytes!)
    expect(reopened.report.canOpen).toBe(true)
    expect(reopened.workbook?.dateSystem).toBe('1904')
    const sheet = reopened.workbook?.sheetsById.get('xlsx-sheet-1')
    expect(sheet?.cells.get('B2')?.value).toEqual({ kind: 'number', value: 8 })
    expect(sheet?.cells.get('B1')?.style?.numberFormat).toBe('0.00')
    expect(sheet?.merges).toHaveLength(2)
    expect(sheet?.cells.get('C1')?.value).toMatchObject({
      kind: 'formula',
      formula: { source: '=SUM(B2,2)', cachedResult: { kind: 'number', value: 7 } },
    })
    expect(reopened.workbook?.sheetsById.get('xlsx-sheet-2')?.name).toBe('Second')
    session.markClean(output.preservation, output.bytes)
    expect(session.isDirty).toBe(false)
  })

  it('requires explicit Save As for a rename that invalidates opaque parts and preserves those parts', async () => {
    const { bytes, workbook } = await openFixture()
    const session = new WorkbookSession(workbook)
    session.renameSheet('xlsx-sheet-1', 'Renamed')
    const output = await exportXlsxWorkbook(session.workbook, 'source.xlsx')
    expect(output.report.canSave).toBe(true)
    expect(output.report.requiresSaveAs).toBe(true)
    expect(
      output.report.entries.some((entry) => entry.category === 'at-risk' && entry.partName === 'customXml/item1.xml'),
    ).toBe(true)
    expect(unzipSync(output.bytes!)['customXml/item1.xml']).toEqual(unzipSync(bytes)['customXml/item1.xml'])
    const reopened = await parseXlsxWorkbook('renamed.xlsx', output.bytes!)
    expect(reopened.workbook?.sheetsById.get('xlsx-sheet-1')?.name).toBe('Renamed')
  })

  it('retains chart and pivot parts, relationships and cache bytes after a cell edit', async () => {
    const bytes = chartPivotFixture()
    const imported = await parseXlsxWorkbook('chart-pivot.xlsx', bytes)
    expect(imported.report.canOpen).toBe(true)
    expect(imported.report.findings.some((finding) => finding.code === 'charts')).toBe(true)
    expect(imported.report.findings.some((finding) => finding.code === 'pivots')).toBe(true)
    const session = new WorkbookSession(imported.workbook!)
    session.setCell('xlsx-sheet-1', 'B2', { kind: 'number', value: 8 })
    const output = await exportXlsxWorkbook(session.workbook, 'chart-pivot.xlsx')
    expect(output.report.canSave).toBe(true)
    expect(output.report.requiresSaveAs).toBe(true)

    const originalParts = unzipSync(bytes)
    const exportedParts = unzipSync(output.bytes!)
    for (const partName of [
      'xl/worksheets/_rels/sheet1.xml.rels',
      'xl/drawings/drawing1.xml',
      'xl/drawings/_rels/drawing1.xml.rels',
      'xl/charts/chart1.xml',
      'xl/pivotTables/pivotTable1.xml',
      'xl/pivotCache/pivotCacheDefinition1.xml',
      'xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels',
      'xl/pivotCache/pivotCacheRecords1.xml',
    ]) {
      expect(exportedParts[partName], partName).toEqual(originalParts[partName])
    }
    expect(Object.keys(exportedParts).sort()).toEqual(Object.keys(originalParts).sort())
    const reopened = await parseXlsxWorkbook('chart-pivot-saved.xlsx', output.bytes!)
    expect(reopened.report.canOpen).toBe(true)
    expect(reopened.workbook?.sheetsById.get('xlsx-sheet-1')?.drawings?.[0]?.kind).toBe('chart')
    expect(reopened.workbook?.sheetsById.get('xlsx-sheet-1')?.pivots?.[0]?.name).toBe('PivotOne')
  })

  it('adds a worksheet to an imported workbook with valid content types and relationships', async () => {
    const { workbook } = await openFixture()
    const session = new WorkbookSession(workbook)
    const sheetId = session.createSheet('Third')
    session.setCell(sheetId, 'C4', { kind: 'string', value: 'added' })
    const output = await exportXlsxWorkbook(session.workbook, 'source.xlsx')
    expect(output.report.canSave).toBe(true)
    expect(output.report.requiresSaveAs).toBe(true)
    const reopened = await parseXlsxWorkbook('with-sheet.xlsx', output.bytes!)
    expect(reopened.report.canOpen).toBe(true)
    expect(reopened.workbook?.sheetOrder).toHaveLength(3)
    expect(reopened.workbook?.sheetsById.get('xlsx-sheet-3')?.cells.get('C4')?.value).toEqual({
      kind: 'string',
      value: 'added',
    })
  })

  it('keeps stale formula caches and asks Excel to recalculate on open', async () => {
    const { workbook } = await openFixture()
    const session = new WorkbookSession(workbook)
    session.setCell('xlsx-sheet-1', 'B2', { kind: 'number', value: 10 })
    const output = await exportXlsxWorkbook(session.workbook, 'source.xlsx')
    expect(output.report.requiresSaveAs).toBe(true)
    expect(output.report.entries.some((entry) => entry.code === 'formula-cache-stale')).toBe(true)
    const reopened = await parseXlsxWorkbook('stale-cache.xlsx', output.bytes!)
    expect(reopened.workbook?.sheetsById.get('xlsx-sheet-1')?.cells.get('C1')?.value).toMatchObject({
      kind: 'formula',
      formula: { cachedResult: { kind: 'number', value: 7 }, calculationStatus: 'unsupported' },
    })
    const workbookXml = new TextDecoder().decode(unzipSync(output.bytes!)['xl/workbook.xml'])
    expect(workbookXml).toContain('fullCalcOnLoad="1"')
    expect(workbookXml).toContain('forceFullCalc="1"')
  })

  it('inserts calculation properties before workbook extensions in schema order', async () => {
    const sourceBytes = editFixturePart(preservationFixture(), 'xl/workbook.xml', (xml) =>
      xml.replace('<calcPr calcMode="auto"/>', '<extLst><ext uri="urn:vendor"/></extLst>'),
    )
    const imported = await parseXlsxWorkbook('workbook-extension.xlsx', sourceBytes)
    expect(imported.workbook).toBeDefined()
    const session = new WorkbookSession(imported.workbook!)
    session.setCell('xlsx-sheet-1', 'B2', { kind: 'number', value: 8 })
    const output = await exportXlsxWorkbook(session.workbook, 'workbook-extension.xlsx')
    expect(output.report.canSave).toBe(true)
    const workbookXml = strFromU8(unzipSync(output.bytes!)['xl/workbook.xml'])
    expect(workbookXml.indexOf('<calcPr')).toBeLessThan(workbookXml.indexOf('<extLst'))
  })

  it('blocks an edited rename when formulas depend on the old sheet name', async () => {
    const { workbook } = await openFixture()
    const session = new WorkbookSession(workbook)
    session.setCell('xlsx-sheet-2', 'B1', {
      kind: 'formula',
      formula: {
        source: "='First'!A1",
        canonicalExpression: "='First'!A1",
        ast: null,
        cachedResult: { kind: 'string', value: 'Text' },
        calculationStatus: 'stale',
      },
    })
    session.renameSheet('xlsx-sheet-1', 'Renamed')
    const output = await exportXlsxWorkbook(session.workbook, 'source.xlsx')
    expect(output.report.canSave).toBe(false)
    expect(output.report.entries.at(-1)).toMatchObject({
      category: 'cannot-preserve',
      code: 'unsupported-sheet-feature',
    })
    expect(output.bytes).toBeUndefined()
  })

  it('blocks a corrupt source package or unsafe internal relationship instead of emitting bytes', async () => {
    const { bytes, workbook } = await openFixture()
    const parts = unzipSync(bytes)
    const unsafeParts = { ...parts }
    unsafeParts['_rels/.rels'] = strToU8(
      `<Relationships xmlns="${packageRel}"><Relationship Id="root" Type="${rel}/officeDocument" Target="../../escape.xml"/></Relationships>`,
    )
    const unsafeSession = new WorkbookSession(workbook)
    unsafeSession.setCell('xlsx-sheet-1', 'B2', { kind: 'number', value: 6 })
    unsafeSession.workbook.preservation!.originalArchiveBytes = zipSync(unsafeParts)
    const unsafe = await exportXlsxWorkbook(unsafeSession.workbook, 'unsafe.xlsx')
    expect(unsafe.report.canSave).toBe(false)
    expect(unsafe.bytes).toBeUndefined()

    const corruptSession = new WorkbookSession(workbook)
    corruptSession.setCell('xlsx-sheet-1', 'B2', { kind: 'number', value: 6 })
    corruptSession.workbook.preservation!.originalArchiveBytes = strToU8('not a zip')
    const corrupt = await exportXlsxWorkbook(corruptSession.workbook, 'corrupt.xlsx')
    expect(corrupt.report.canSave).toBe(false)
    expect(corrupt.bytes).toBeUndefined()
  })

  it('blocks invalid OOXML and invalid XML cell text before returning bytes', async () => {
    const workbook = createWorkbook()
    const session = new WorkbookSession(workbook)
    session.setCell(workbook.activeSheetId, 'A1', { kind: 'string', value: 'unsafe\u0000text' })
    const output = await exportXlsxWorkbook(session.workbook, 'new.xlsx')
    expect(output.report.canSave).toBe(false)
    expect(output.report.entries.at(-1)).toMatchObject({ category: 'cannot-preserve', code: 'output-invalid' })
    expect(output.bytes).toBeUndefined()
  })

  it('blocks metadata edits that would discard unsupported column or merge markup', async () => {
    const columnBytes = editFixtureWorksheet(preservationFixture(), (xml) =>
      xml.replace(
        'width="20" customWidth="1"',
        'width="20" customWidth="1" vendor:flags="keep" xmlns:vendor="urn:vendor"',
      ),
    )
    const columnImport = await parseXlsxWorkbook('columns.xlsx', columnBytes)
    expect(columnImport.workbook).toBeDefined()
    const columnSession = new WorkbookSession(columnImport.workbook!)
    columnSession.setColumnMetadata('xlsx-sheet-1', 2, { width: 21 })
    const columnOutput = await exportXlsxWorkbook(columnSession.workbook, 'columns.xlsx')
    expect(columnOutput.report.canSave).toBe(false)
    expect(columnOutput.bytes).toBeUndefined()

    const mergeBytes = editFixtureWorksheet(preservationFixture(), (xml) =>
      xml.replace(
        '<mergeCells count="1"><mergeCell ref="A3:B3"/></mergeCells>',
        '<mergeCells count="1"><mergeCell ref="A3:B3"/><vendor:mergeExtension xmlns:vendor="urn:vendor"/></mergeCells>',
      ),
    )
    const mergeImport = await parseXlsxWorkbook('merges.xlsx', mergeBytes)
    expect(mergeImport.workbook).toBeDefined()
    const mergeSession = new WorkbookSession(mergeImport.workbook!)
    mergeSession.merge('xlsx-sheet-1', 'C4:D4')
    const mergeOutput = await exportXlsxWorkbook(mergeSession.workbook, 'merges.xlsx')
    expect(mergeOutput.report.canSave).toBe(false)
    expect(mergeOutput.bytes).toBeUndefined()
  })

  it('blocks rewriting a formula with unsupported OOXML attributes', async () => {
    const sourceBytes = editFixtureWorksheet(preservationFixture(), (xml) =>
      xml.replace('<f>SUM(B2,2)</f>', '<f ca="1">SUM(B2,2)</f>'),
    )
    const imported = await parseXlsxWorkbook('formula-attributes.xlsx', sourceBytes)
    expect(imported.workbook).toBeDefined()
    const session = new WorkbookSession(imported.workbook!)
    session.setCell('xlsx-sheet-1', 'C1', { kind: 'number', value: 12 })
    const output = await exportXlsxWorkbook(session.workbook, 'formula-attributes.xlsx')
    expect(output.report.canSave).toBe(false)
    expect(output.bytes).toBeUndefined()
  })

  it('writes a new workbook and adds a sheet without allocating dense cells', async () => {
    const workbook = createWorkbook({ firstSheetName: 'Grid' })
    const session = new WorkbookSession(workbook)
    session.setCell(workbook.activeSheetId, 'A1', { kind: 'number', value: 42 })
    session.formatCells(workbook.activeSheetId, [
      {
        address: 'A1',
        style: {
          font: { bold: true, underline: true, color: '#204060' },
          fill: { color: '#ffeecc', pattern: 'solid' },
          numberFormat: '"PLN" #,##0.00',
          alignment: { horizontal: 'center', wrapText: true },
        },
      },
    ])
    session.setCell(workbook.activeSheetId, 'B1', {
      kind: 'formula',
      formula: {
        source: '=A1*2',
        canonicalExpression: '=A1*2',
        ast: null,
        cachedResult: { kind: 'number', value: 84 },
        calculationStatus: 'fresh',
      },
    })
    const addedId = session.createSheet('Second')
    session.setCell(addedId, 'D5', { kind: 'string', value: 'new sheet' })
    const output = await exportXlsxWorkbook(session.workbook, 'Book1.xlsx')
    expect(output.report.canSave, JSON.stringify(output.report)).toBe(true)
    expect(output.bytes).toBeDefined()
    const reopened = await parseXlsxWorkbook('new.xlsx', output.bytes!)
    expect(reopened.report.canOpen).toBe(true)
    expect(reopened.workbook?.sheetOrder).toHaveLength(2)
    expect(reopened.workbook?.sheetsById.get('xlsx-sheet-1')?.cells.get('A1')).toMatchObject({
      value: { kind: 'number', value: 42 },
      style: {
        font: { bold: true, underline: true, color: '#204060' },
        fill: { color: '#FFEECC', pattern: 'solid' },
        numberFormat: '"PLN" #,##0.00',
        alignment: { horizontal: 'center', wrapText: true },
      },
    })
    expect(reopened.workbook?.sheetsById.get('xlsx-sheet-1')?.cells.get('B1')?.value).toMatchObject({
      kind: 'formula',
      formula: { source: '=A1*2', cachedResult: { kind: 'number', value: 84 } },
    })
    expect(reopened.workbook?.sheetsById.get('xlsx-sheet-2')?.cells.get('D5')?.value).toEqual({
      kind: 'string',
      value: 'new sheet',
    })
    expect(reopened.workbook?.sheetsById.get('xlsx-sheet-1')?.cells.size).toBe(2)
  })

  it('exports localized supported input as canonical OOXML and leaves unsupported formula source exact', async () => {
    const workbook = createWorkbook({ firstSheetName: 'Grid' })
    const session = new WorkbookSession(workbook)
    const supported = inferFormula('=SUMA(1,5;2,5)', 'en', '1900')
    const unsupported = inferFormula('=FUTUREFUNC(A1;1,5)', 'pl', '1900')
    session.setCell(workbook.activeSheetId, 'A1', supported)
    session.setCell(workbook.activeSheetId, 'A2', unsupported)

    const output = await exportXlsxWorkbook(workbook, 'localized.xlsx')
    expect(output.report.canSave, JSON.stringify(output.report)).toBe(true)
    const parts = unzipSync(output.bytes!)
    const sheetXml = strFromU8(parts['xl/worksheets/sheet1.xml'])
    expect(sheetXml).toContain('<f>SUM(1.5,2.5)</f>')
    expect(sheetXml).toContain('<f>FUTUREFUNC(A1;1,5)</f>')
    const reopened = await parseXlsxWorkbook('localized.xlsx', output.bytes!)
    expect(reopened.workbook?.sheetsById.get('xlsx-sheet-1')?.cells.get('A1')?.value).toMatchObject({
      kind: 'formula',
      formula: { source: '=SUM(1.5,2.5)' },
    })
    expect(reopened.workbook?.sheetsById.get('xlsx-sheet-1')?.cells.get('A2')?.value).toMatchObject({
      kind: 'formula',
      formula: { source: '=FUTUREFUNC(A1;1,5)' },
    })
  })
})

function inferFormula(source: string, locale: 'en' | 'pl', dateSystem: '1900' | '1904') {
  const cell = inferCellValue(source, locale, dateSystem)
  if (cell.kind !== 'formula') throw new Error('Formula fixture expected.')
  return cell
}
