import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { parseXlsxWorkbook } from './import'
import type { XlsxImportPreflight } from './types'

const mainNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const relationshipsNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const packageRelationshipsNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships'
const contentTypesNamespace = 'http://schemas.openxmlformats.org/package/2006/content-types'

interface FixtureOptions {
  strict?: boolean
  formula?: string
  brokenSharedString?: boolean
  malformedWorksheet?: boolean
  unknownPart?: boolean
  externalTarget?: string
  includeComplexParts?: boolean
  activeContent?: boolean
  entityExpansion?: boolean
  basicComments?: boolean
  date1904?: boolean
  unsafeRelationship?: boolean
}

function workbookFixture(options: FixtureOptions = {}): Uint8Array {
  const spreadsheetNamespace = options.strict ? 'http://purl.oclc.org/ooxml/spreadsheetml/main' : mainNamespace
  const sheetOne = options.malformedWorksheet
    ? '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row></worksheet>'
    : `<worksheet xmlns="${spreadsheetNamespace}" xmlns:r="${relationshipsNamespace}">
      <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
      <sheetFormatPr defaultRowHeight="18" defaultColWidth="9"/>
      <cols><col min="2" max="2" width="20" customWidth="1"/></cols>
      <sheetData>
        <row r="1" ht="25" customHeight="1"><c r="A1" t="s"><v>0</v></c><c r="B1" s="1"><v>45123</v></c><c r="C1"><f>${options.formula ?? 'SUM(B2,2)'}</f><v>7</v></c><c r="D1" t="inlineStr"><is><r><t>Inline </t></r><r><t>text</t></r></is></c></row>
        <row r="2"><c r="A2" t="b"><v>1</v></c><c r="B2"><v>5</v></c><c r="C2" t="e"><v>#N/A</v></c></row>
        <row r="3"><c r="A3" t="inlineStr"><is><t>merged</t></is></c></row>
      </sheetData>
      <autoFilter ref="A1:C2"/>
      <mergeCells count="1"><mergeCell ref="A3:B3"/></mergeCells>
      <conditionalFormatting sqref="B1"><cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan"><formula>10</formula></cfRule></conditionalFormatting>
      <dataValidations count="1"><dataValidation type="whole" operator="greaterThan" sqref="B2"><formula1>0</formula1></dataValidation></dataValidations>
      <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
      <pageSetup orientation="landscape" paperSize="9"/><printOptions horizontalCentered="1"/>
      ${options.externalTarget ? '<hyperlinks><hyperlink ref="A1" r:id="externalLink1" tooltip="External"/></hyperlinks>' : ''}
      ${options.basicComments ? '<legacyDrawing r:id="vml1"/>' : ''}
      ${options.includeComplexParts ? '<drawing r:id="drawing1"/><tableParts count="1"><tablePart r:id="table1"/></tableParts><pivotTableParts count="1"><pivotTablePart r:id="pivot1"/></pivotTableParts>' : ''}
    </worksheet>`
  const parts: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<Types xmlns="${contentTypesNamespace}">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Default Extension="bin" ContentType="application/octet-stream"/>
      <Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>
      <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
      <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
      <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
      ${options.includeComplexParts ? '<Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/><Override PartName="/xl/pivotTables/pivotTable1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml"/><Override PartName="/xl/pivotCache/pivotCacheDefinition1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml"/><Override PartName="/xl/pivotCache/pivotCacheRecords1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml"/>' : ''}
      ${options.basicComments ? '<Override PartName="/xl/comments1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>' : ''}
      ${options.unknownPart ? '<Override PartName="/customXml/item1.xml" ContentType="application/xml"/>' : ''}
      ${options.activeContent ? '<Override PartName="/xl/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/>' : ''}
    </Types>`),
    '_rels/.rels': strToU8(`<Relationships xmlns="${packageRelationshipsNamespace}">
      <Relationship Id="rootWorkbook" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${options.unsafeRelationship ? '../../escape.xml' : 'xl/workbook.xml'}"/>
      ${options.unknownPart ? '<Relationship Id="customXml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="customXml/item1.xml"/>' : ''}
    </Relationships>`),
    'xl/workbook.xml': strToU8(`<workbook xmlns="${spreadsheetNamespace}" xmlns:r="${relationshipsNamespace}">
      <workbookPr date1904="${options.date1904 ? '1' : '0'}"/><bookViews><workbookView activeTab="1"/></bookViews>
      <sheets><sheet name="Data Sheet" sheetId="1" r:id="sheetRel1"/><sheet name="Summary" sheetId="2" state="hidden" r:id="sheetRel2"/></sheets>
      <definedNames><definedName name="MyValue">'Data Sheet'!$B$2</definedName><definedName name="_xlnm.Print_Area" localSheetId="0">'Data Sheet'!$A$1:$D$3</definedName></definedNames>
      ${options.includeComplexParts ? '<pivotCaches><pivotCache cacheId="1" r:id="pivotCache1"/></pivotCaches>' : ''}
    </workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<Relationships xmlns="${packageRelationshipsNamespace}">
      <Relationship Id="sheetRel1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
      <Relationship Id="sheetRel2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
      <Relationship Id="styles1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
      <Relationship Id="strings1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
      ${options.includeComplexParts ? '<Relationship Id="pivotCache1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition1.xml"/>' : ''}
    </Relationships>`),
    'xl/worksheets/sheet1.xml': strToU8(sheetOne),
    'xl/worksheets/sheet2.xml': strToU8(
      `<worksheet xmlns="${spreadsheetNamespace}"><sheetData><row r="1"><c r="A1"><f>'Data Sheet'!B2</f><v>5</v></c></row></sheetData></worksheet>`,
    ),
    'xl/worksheets/_rels/sheet1.xml.rels': strToU8(`<Relationships xmlns="${packageRelationshipsNamespace}">
      ${options.externalTarget ? `<Relationship Id="externalLink1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${options.externalTarget}" TargetMode="External"/>` : ''}
      ${options.basicComments ? '<Relationship Id="comments1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments1.xml"/><Relationship Id="vml1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/>' : ''}
      ${options.includeComplexParts ? '<Relationship Id="drawing1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/><Relationship Id="table1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/><Relationship Id="pivot1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotTable" Target="../pivotTables/pivotTable1.xml"/>' : ''}
    </Relationships>`),
    'xl/styles.xml': strToU8(`<styleSheet xmlns="${spreadsheetNamespace}">
      <numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>
      <fonts count="2"><font/><font><b/><name val="Aptos"/><sz val="12"/></font></fonts>
      <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
      <borders count="1"><border/></borders>
      <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
      <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" applyNumberFormat="1"/></cellXfs>
    </styleSheet>`),
    'xl/sharedStrings.xml': strToU8(
      `<sst xmlns="${spreadsheetNamespace}" count="1" uniqueCount="1"><si><r><t>Shared </t></r><r><t>text</t></r></si></sst>`,
    ),
  }
  if (options.unknownPart) parts['customXml/item1.xml'] = strToU8('<item><opaque>vendor payload</opaque></item>')
  if (options.basicComments) {
    parts['xl/comments1.xml'] = strToU8(
      `<comments xmlns="${mainNamespace}"><authors><author>Reviewer</author></authors><commentList><comment ref="D1" authorId="0"><text><r><t>Keep this note</t></r></text></comment></commentList></comments>`,
    )
    parts['xl/drawings/vmlDrawing1.vml'] = strToU8('<xml xmlns:v="urn:schemas-microsoft-com:vml"/>')
  }
  if (options.activeContent) parts['xl/vbaProject.bin'] = strToU8('macro bytes are never executed')
  if (options.externalTarget) {
    // Avoid XML injection in fixtures while still testing non-fetching external targets.
    parts['xl/worksheets/_rels/sheet1.xml.rels'] = strToU8(
      `<Relationships xmlns="${packageRelationshipsNamespace}"><Relationship Id="externalLink1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${options.externalTarget}" TargetMode="External"/></Relationships>`,
    )
  }
  if (options.includeComplexParts) {
    parts['xl/drawings/drawing1.xml'] = strToU8(
      `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${relationshipsNamespace}"><xdr:graphicFrame><xdr:graphic><a:graphicData xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart r:id="chart1"/></a:graphicData></xdr:graphic></xdr:graphicFrame></xdr:wsDr>`,
    )
    parts['xl/drawings/_rels/drawing1.xml.rels'] = strToU8(
      `<Relationships xmlns="${packageRelationshipsNamespace}"><Relationship Id="chart1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>`,
    )
    parts['xl/charts/chart1.xml'] = strToU8(
      '<chartSpace xmlns="http://schemas.openxmlformats.org/drawingml/2006/chart"/>',
    )
    parts['xl/tables/table1.xml'] = strToU8(
      `<table xmlns="${mainNamespace}" id="1" name="DataTable" displayName="DataTable" ref="A1:C2"><tableColumns count="3"><tableColumn id="1" name="Name"/><tableColumn id="2" name="Date"/><tableColumn id="3" name="Formula"/></tableColumns></table>`,
    )
    parts['xl/pivotTables/pivotTable1.xml'] = strToU8(
      `<pivotTableDefinition xmlns="${mainNamespace}" name="PivotOne" cacheId="1"><location ref="E1:G5"/></pivotTableDefinition>`,
    )
    parts['xl/pivotCache/pivotCacheDefinition1.xml'] = strToU8(
      `<pivotCacheDefinition xmlns="${mainNamespace}" cacheId="1" r:id="pivotRecords1" xmlns:r="${relationshipsNamespace}"><cacheSource type="worksheet"><worksheetSource ref="A1:C2" sheet="Data Sheet"/></cacheSource></pivotCacheDefinition>`,
    )
    parts['xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels'] = strToU8(
      `<Relationships xmlns="${packageRelationshipsNamespace}"><Relationship Id="pivotRecords1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheRecords" Target="pivotCacheRecords1.xml"/></Relationships>`,
    )
    parts['xl/pivotCache/pivotCacheRecords1.xml'] = strToU8(
      `<pivotCacheRecords xmlns="${mainNamespace}" count="1"><r><n v="5"/></r></pivotCacheRecords>`,
    )
  }
  if (options.entityExpansion) {
    parts['xl/sharedStrings.xml'] = strToU8(
      `<!DOCTYPE sst [<!ENTITY x "expanded">]><sst xmlns="${mainNamespace}><si><t>&x;</t></si></sst>`,
    )
  }
  if (options.brokenSharedString) {
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      `<worksheet xmlns="${mainNamespace}"><sheetData><row r="1"><c r="A1" t="s"><v>8</v></c></row></sheetData></worksheet>`,
    )
  }
  return zipSync(parts, { level: 6 })
}

function finding(result: XlsxImportPreflight, code: string) {
  return result.report.findings.find((item) => item.code === code)
}

describe('Grid XLSX import preflight', () => {
  it('maps a minimal inline-string workbook with a cached formula', async () => {
    const minimal = zipSync(
      {
        '[Content_Types].xml': strToU8(
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
        ),
        '_rels/.rels': strToU8(
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="root" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        ),
        'xl/workbook.xml': strToU8(
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Imported" sheetId="1" r:id="sheet1"/></sheets></workbook>',
        ),
        'xl/_rels/workbook.xml.rels': strToU8(
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sheet1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
        ),
        'xl/worksheets/sheet1.xml': strToU8(
          '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>opened from xlsx</t></is></c></row><row r="2"><c r="A2"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>',
        ),
      },
      { level: 0 },
    )
    const result = await parseXlsxWorkbook('fixture.xlsx', minimal)
    expect(result.report.canOpen).toBe(true)
    expect(result.workbook?.sheetsById.get('xlsx-sheet-1')?.cells.get('A1')?.value).toEqual({
      kind: 'string',
      value: 'opened from xlsx',
    })
  })

  it('maps sheets, sparse values, formula source and cache, styles, merges, dimensions and workbook settings', async () => {
    const progress: number[] = []
    const bytes = workbookFixture()
    const result = await parseXlsxWorkbook('sample.xlsx', bytes, ({ percent }) => progress.push(percent))
    expect(result.report.canOpen).toBe(true)
    expect(result.report.sheetCount).toBe(2)
    expect(result.report.cellCount).toBe(9)
    expect(result.workbook?.activeSheetId).toBe('xlsx-sheet-1')
    const data = result.workbook?.sheetsById.get('xlsx-sheet-1')
    expect(data?.cells.get('A1')?.value).toEqual({ kind: 'string', value: 'Shared text' })
    expect(data?.cells.get('B1')?.value).toEqual({ kind: 'date', serial: 45123, numberFormat: 'yyyy-mm-dd' })
    expect(data?.cells.get('B1')?.style?.font?.bold).toBe(true)
    expect(data?.cells.get('C1')?.value).toMatchObject({
      kind: 'formula',
      formula: {
        source: '=SUM(B2,2)',
        canonicalExpression: '=SUM(B2,2)',
        cachedResult: { kind: 'number', value: 7 },
        calculationStatus: 'unsupported',
      },
    })
    expect(data?.cells.get('D1')?.value).toEqual({ kind: 'string', value: 'Inline text' })
    expect(data?.cells.get('C2')?.value).toEqual({ kind: 'error', code: '#N/A' })
    expect(data?.merges).toHaveLength(1)
    expect(data?.frozenPane).toMatchObject({ ySplit: 1, topLeftCell: 'A2' })
    expect(data?.rowMetadata.get(1)?.height).toBe(25)
    expect(data?.columnMetadata.get(2)?.width).toBe(20)
    expect(data?.autoFilter?.range).toBeDefined()
    expect(data?.validations).toHaveLength(1)
    expect(data?.conditionalFormats).toHaveLength(1)
    expect(data?.printSettings).toMatchObject({
      pageSetup: { orientation: 'landscape', paperSize: '9' },
      printOptions: { horizontalCentered: '1' },
      printArea: "'Data Sheet'!$A$1:$D$3",
    })
    expect(result.workbook?.definedNames[0]).toMatchObject({ name: 'MyValue', formula: "'Data Sheet'!$B$2" })
    expect(result.workbook?.sheetsById.get('xlsx-sheet-2')?.visibility).toBe('hidden')
    expect(progress.at(-1)).toBe(100)
    expect(progress.some((percent) => percent > 0 && percent < 100)).toBe(true)
  })

  it('retains source archive bytes and inventories unknown parts as opaque', async () => {
    const bytes = workbookFixture({ unknownPart: true })
    const result = await parseXlsxWorkbook('opaque.xlsx', bytes)
    expect(result.report.canOpen).toBe(true)
    expect(finding(result, 'custom-xml')?.category).toBe('preservable-opaque')
    expect(result.workbook?.preservation?.parts.find((part) => part.partName === 'customXml/item1.xml')?.status).toBe(
      'safe',
    )
    expect(
      result.workbook?.preservation?.inventory?.relationships.some((rel) => rel.target === 'customXml/item1.xml'),
    ).toBe(true)
    expect([...result.workbook!.preservation!.originalArchiveBytes!]).toEqual([...bytes])
  })

  it('imports basic legacy comments and preserves the workbook 1904 date mode', async () => {
    const result = await parseXlsxWorkbook(
      'comments-1904.xlsx',
      workbookFixture({ basicComments: true, date1904: true }),
    )
    expect(result.report.canOpen).toBe(true)
    expect(result.workbook?.dateSystem).toBe('1904')
    expect(result.workbook?.sheetsById.get('xlsx-sheet-1')?.comments).toEqual([
      { address: 'D1', author: 'Reviewer', text: 'Keep this note', sourcePartName: 'xl/comments1.xml' },
    ])
    expect(finding(result, 'comments')?.category).toBe('readable-not-editable')
  })

  it('reports charts, pivot caches, tables and drawings as at risk instead of hiding them', async () => {
    const result = await parseXlsxWorkbook('features.xlsx', workbookFixture({ includeComplexParts: true }))
    expect(result.report.canOpen).toBe(true)
    expect(finding(result, 'charts')?.category).toBe('at-risk')
    expect(finding(result, 'pivots')?.category).toBe('at-risk')
    expect(finding(result, 'drawings')?.category).toBe('at-risk')
    expect(result.workbook?.sheetsById.get('xlsx-sheet-1')?.tables).toHaveLength(1)
    expect(result.workbook?.sheetsById.get('xlsx-sheet-1')?.drawings?.[0]?.kind).toBe('chart')
    expect(result.workbook?.sheetsById.get('xlsx-sheet-1')?.pivots?.[0]?.name).toBe('PivotOne')
  })

  it('rejects corrupt, oversized-ratio, encrypted and unsupported-version input before a workbook can be committed', async () => {
    const corrupt = await parseXlsxWorkbook('bad.xlsx', strToU8('not a zip archive'))
    expect(corrupt.report.canOpen).toBe(false)
    expect(finding(corrupt, 'archive-invalid')?.category).toBe('blocked')

    const bombBytes = zipSync({ 'xl/data.bin': strToU8('x'.repeat(2_000_000)) }, { level: 9 })
    const bomb = await parseXlsxWorkbook('bomb.xlsx', bombBytes)
    expect(finding(bomb, 'archive-limit')?.category).toBe('blocked')

    const encryptedBytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    const encrypted = await parseXlsxWorkbook('password.xlsx', encryptedBytes)
    expect(finding(encrypted, 'encrypted')?.category).toBe('blocked')

    const strict = await parseXlsxWorkbook('strict.xlsx', workbookFixture({ strict: true }))
    expect(finding(strict, 'unsupported-version')?.category).toBe('blocked')
  })

  it('blocks unsafe XML and broken shared string indexes', async () => {
    const entity = await parseXlsxWorkbook('entity.xlsx', workbookFixture({ entityExpansion: true }))
    expect(finding(entity, 'malformed-xml')?.category).toBe('blocked')

    const malformed = await parseXlsxWorkbook('malformed.xlsx', workbookFixture({ malformedWorksheet: true }))
    expect(finding(malformed, 'malformed-xml')?.category).toBe('blocked')

    const sharedString = await parseXlsxWorkbook('strings.xlsx', workbookFixture({ brokenSharedString: true }))
    expect(finding(sharedString, 'broken-shared-string')?.category).toBe('blocked')
  })

  it('blocks package relationships that escape the archive root', async () => {
    const result = await parseXlsxWorkbook('unsafe-rel.xlsx', workbookFixture({ unsafeRelationship: true }))
    expect(result.report.canOpen).toBe(false)
    expect(finding(result, 'unsafe-relationship')?.category).toBe('blocked')
  })

  it('keeps external hyperlinks inert and retains malformed formula source and cache', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const external = await parseXlsxWorkbook(
      'external.xlsx',
      workbookFixture({ externalTarget: 'https://example.invalid/data' }),
    )
    expect(external.report.canOpen).toBe(true)
    expect(finding(external, 'external-targets')?.category).toBe('at-risk')
    expect(external.workbook?.sheetsById.get('xlsx-sheet-1')?.hyperlinks?.[0]).toMatchObject({
      target: 'https://example.invalid/data',
      targetMode: 'External',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()

    const malformedFormula = await parseXlsxWorkbook('formula.xlsx', workbookFixture({ formula: 'SUM(' }))
    expect(finding(malformedFormula, 'malformed-formula')?.category).toBe('readable-not-editable')
    expect(malformedFormula.workbook?.sheetsById.get('xlsx-sheet-1')?.cells.get('C1')?.value).toMatchObject({
      kind: 'formula',
      formula: { source: '=SUM(', cachedResult: { kind: 'number', value: 7 }, calculationStatus: 'unsupported' },
    })
  })

  it('rejects duplicate names and traversal paths in the central directory', async () => {
    const duplicateBytes = replaceEveryAscii(
      zipSync({ 'aa.txt': strToU8('a'), 'bb.txt': strToU8('b') }),
      'bb.txt',
      'aa.txt',
    )
    const duplicate = await parseXlsxWorkbook('duplicate.xlsx', duplicateBytes)
    expect(finding(duplicate, 'archive-invalid')?.category).toBe('blocked')

    const traversalBytes = replaceEveryAscii(zipSync({ 'a.xml': strToU8('a') }), 'a.xml', '../ab')
    const traversal = await parseXlsxWorkbook('traversal.xlsx', traversalBytes)
    expect(finding(traversal, 'archive-invalid')?.category).toBe('blocked')
  })

  it('reports active content in a disguised xlsx as blocked', async () => {
    const result = await parseXlsxWorkbook('macro-disguised.xlsx', workbookFixture({ activeContent: true }))
    expect(result.report.canOpen).toBe(false)
    expect(finding(result, 'active-content')?.category).toBe('blocked')
  })
})

describe('Grid import package validation', () => {
  function rewrite(change: (parts: Record<string, Uint8Array>) => void, options: FixtureOptions = {}) {
    const parts = unzipSync(workbookFixture(options))
    change(parts)
    return zipSync(parts, { level: 0 })
  }

  it('uses shared strings and styles relationship targets instead of fixed package paths', async () => {
    const bytes = rewrite((parts) => {
      for (const [oldName, newName] of [
        ['sharedStrings.xml', 'strings-renamed.xml'],
        ['styles.xml', 'styles-renamed.xml'],
      ]) {
        parts[`xl/${newName}`] = parts[`xl/${oldName}`]
        delete parts[`xl/${oldName}`]
        for (const part of ['[Content_Types].xml', 'xl/_rels/workbook.xml.rels'])
          parts[part] = strToU8(strFromU8(parts[part]).replaceAll(oldName, newName))
      }
    })
    const result = await parseXlsxWorkbook('relocated.xlsx', bytes)
    expect(result.report.canOpen).toBe(true)
    const sheet = result.workbook!.sheetsById.get('xlsx-sheet-1')!
    expect(sheet.cells.get('A1')?.value).toEqual({ kind: 'string', value: 'Shared text' })
    expect(sheet.cells.get('B1')?.style).toMatchObject({ numberFormat: 'yyyy-mm-dd', font: { bold: true } })
    expect(finding(result, 'defined-names')?.category).toBe('readable-not-editable')
    expect(result.workbook!.definedNames[0]).toMatchObject({
      targetSheetId: sheet.id,
      range: { start: { row: 2, column: 2 } },
    })
  })

  it('validates opaque XML too and never retains a model from a blocked package', async () => {
    for (const content of [
      '<!DOCTYPE x [<!ENTITY e "expand">]><x>&e;</x>',
      '<x><broken></x>',
      '<x attribute=unquoted/>',
    ]) {
      const bytes = rewrite(
        (parts) => {
          parts['customXml/item1.xml'] = strToU8(content)
        },
        { unknownPart: true },
      )
      const result = await parseXlsxWorkbook('opaque-invalid.xlsx', bytes)
      expect(result.report.canOpen).toBe(false)
      expect(finding(result, 'malformed-xml')?.category).toBe('blocked')
      expect(result.workbook).toBeUndefined()
    }
  })

  it('reports nested unknown nodes and skips phonetic annotations in displayed string values', async () => {
    const bytes = rewrite((parts) => {
      parts['xl/sharedStrings.xml'] = strToU8(
        `<sst xmlns="${mainNamespace}"><si><t>base</t><rPh sb="0" eb="4"><t>phonetic</t></rPh><custom xmlns="urn:unknown"><t>opaque</t></custom></si></sst>`,
      )
    })
    const result = await parseXlsxWorkbook('unknown-node.xlsx', bytes)
    expect(result.report.canOpen).toBe(true)
    expect(result.workbook!.sheetsById.get('xlsx-sheet-1')!.cells.get('A1')?.value).toEqual({
      kind: 'string',
      value: 'base',
    })
    expect(finding(result, 'unknown-nodes')?.category).toBe('at-risk')
    expect(finding(result, 'unknown-nodes')?.partNames).toContain('xl/sharedStrings.xml')
  })

  it('rejects wrong XML roots, duplicate content types and missing relationship references', async () => {
    const mutations: Array<(parts: Record<string, Uint8Array>) => void> = [
      (parts) => {
        parts['xl/workbook.xml'] = strToU8(
          strFromU8(parts['xl/workbook.xml'])
            .replaceAll('workbook>', 'notWorkbook>')
            .replace('<workbook ', '<notWorkbook '),
        )
      },
      (parts) => {
        parts['[Content_Types].xml'] = strToU8(
          strFromU8(parts['[Content_Types].xml']).replace(
            '</Types>',
            '<Default Extension="xml" ContentType="application/xml"/></Types>',
          ),
        )
      },
      (parts) => {
        parts['xl/worksheets/sheet1.xml'] = strToU8(
          strFromU8(parts['xl/worksheets/sheet1.xml']).replace(
            '</worksheet>',
            '<hyperlinks><hyperlink ref="A1" r:id="missing"/></hyperlinks></worksheet>',
          ),
        )
      },
      (parts) => {
        parts['xl/_rels/orphan.xml.rels'] = strToU8(`<Relationships xmlns="${packageRelationshipsNamespace}"/>`)
      },
    ]
    for (const mutate of mutations) {
      const result = await parseXlsxWorkbook('invalid.xlsx', rewrite(mutate))
      expect(result.report.canOpen).toBe(false)
      expect(result.workbook).toBeUndefined()
    }
  })

  it('rejects empty shared-string indexes, invalid rows, overlapping merges and invalid name scopes', async () => {
    const cases: Array<[string, string, string]> = [
      ['xl/worksheets/sheet1.xml', '<v>0</v>', '<v/>'],
      ['xl/worksheets/sheet1.xml', '<row r="3">', '<row r="1048577">'],
      ['xl/worksheets/sheet1.xml', '</mergeCells>', '<mergeCell ref="B3:C3"/></mergeCells>'],
      ['xl/workbook.xml', 'localSheetId="0"', 'localSheetId="99"'],
    ]
    for (const [part, from, to] of cases) {
      const result = await parseXlsxWorkbook(
        'invalid.xlsx',
        rewrite((parts) => {
          parts[part] = strToU8(strFromU8(parts[part]).replace(from, to))
        }),
      )
      expect(result.report.canOpen).toBe(false)
      expect(result.workbook).toBeUndefined()
    }
  })

  it('does not allocate explicit unformatted blank cells or double-count chart/pivot parts', async () => {
    const bytes = rewrite(
      (parts) => {
        parts['xl/worksheets/sheet1.xml'] = strToU8(
          strFromU8(parts['xl/worksheets/sheet1.xml']).replace('<row r="3">', '<row r="3"><c r="Z3"/>'),
        )
      },
      { includeComplexParts: true },
    )
    const result = await parseXlsxWorkbook('sparse.xlsx', bytes)
    expect(result.report.canOpen).toBe(true)
    expect(result.workbook!.sheetsById.get('xlsx-sheet-1')!.cells.has('Z3')).toBe(false)
    expect(finding(result, 'charts')?.count).toBe(1)
    expect(finding(result, 'pivots')?.count).toBe(4) // Table, cache definition, cache records and cache relationships.
  })

  it('checks local header offsets and metadata before attempting ZIP inflation', async () => {
    for (const mutation of ['offset', 'name', 'encryption'] as const) {
      const bytes = workbookFixture().slice()
      const view = new DataView(bytes.buffer)
      let central = 0
      while (central + 46 < bytes.length && view.getUint32(central, true) !== 0x02014b50) central++
      const local = view.getUint32(central + 42, true)
      if (mutation === 'offset') view.setUint32(central + 42, 1, true)
      if (mutation === 'name') bytes[local + 30] ^= 1
      if (mutation === 'encryption') view.setUint16(local + 6, view.getUint16(local + 6, true) | 1, true)
      const result = await parseXlsxWorkbook('corrupt-local.xlsx', bytes)
      expect(result.report.canOpen).toBe(false)
      expect(finding(result, mutation === 'encryption' ? 'encrypted' : 'archive-invalid')?.category).toBe('blocked')
    }
  })
})

function replaceEveryAscii(bytes: Uint8Array, from: string, to: string): Uint8Array {
  const output = bytes.slice()
  const source = strToU8(from)
  const replacement = strToU8(to)
  if (source.length !== replacement.length) throw new Error('Fixture patch must keep the same name length.')
  for (let offset = 0; offset <= output.length - source.length; offset += 1) {
    if (source.every((byte, index) => output[offset + index] === byte)) {
      output.set(replacement, offset)
      offset += source.length - 1
    }
  }
  return output
}
