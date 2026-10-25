import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const packageRel = 'http://schemas.openxmlformats.org/package/2006/relationships'
const contentTypes = 'http://schemas.openxmlformats.org/package/2006/content-types'

/** Synthetic modern comment thread; deliberately opaque to Grid, never flattened into legacy notes. */
export function threadedFixture(): Uint8Array {
  const parts = unzipSync(preservationFixture())
  parts['xl/threadedComments/thread1.xml'] = strToU8(
    '<ThreadedComments xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments"><threadedComment ref="D5" personId="{11111111-1111-1111-1111-111111111111}" id="{22222222-2222-2222-2222-222222222222}" dT="2026-01-01T00:00:00Z"><text>Keep this thread</text></threadedComment></ThreadedComments>',
  )
  parts['xl/persons/person.xml'] = strToU8(
    '<personList xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments"><person displayName="Reviewer" id="{11111111-1111-1111-1111-111111111111}" userId="synthetic" providerId="None"/></personList>',
  )
  parts['xl/worksheets/_rels/sheet1.xml.rels'] = strToU8(
    `<Relationships xmlns="${packageRel}"><Relationship Id="thread" Type="http://schemas.microsoft.com/office/2017/10/relationships/threadedComment" Target="../threadedComments/./%74hread1.xml"/></Relationships>`,
  )
  parts['xl/_rels/workbook.xml.rels'] = strToU8(
    strFromU8(parts['xl/_rels/workbook.xml.rels']).replace(
      '</Relationships>',
      '<Relationship Id="person" Type="http://schemas.microsoft.com/office/2017/10/relationships/person" Target="persons/person.xml"/></Relationships>',
    ),
  )
  parts['[Content_Types].xml'] = strToU8(
    strFromU8(parts['[Content_Types].xml']).replace(
      '</Types>',
      '<Override PartName="/xl/threadedComments/thread1.xml" ContentType="application/vnd.ms-excel.threadedcomments+xml"/><Override PartName="/xl/persons/person.xml" ContentType="application/vnd.ms-excel.person+xml"/></Types>',
    ),
  )
  return zipSync(parts)
}

export function preservationFixture(): Uint8Array {
  // The test fixture is intentionally assembled as OOXML parts instead of using an XLSX writer.
  // This makes unknown parts and relationships visible to the preservation assertions.
  return zipSync(
    Object.fromEntries(
      Object.entries({
        '[Content_Types].xml': `<Types xmlns="${contentTypes}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/customXml/item1.xml" ContentType="application/xml"/></Types>`,
        '_rels/.rels': `<Relationships xmlns="${packageRel}"><Relationship Id="root" Type="${rel}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="custom" Type="${rel}/customXml" Target="customXml/item1.xml"/></Relationships>`,
        'xl/workbook.xml': `<workbook xmlns="${main}" xmlns:r="${rel}"><workbookPr date1904="1"/><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="First" sheetId="1" r:id="rId1"/><sheet name="Second" sheetId="2" r:id="rId2"/></sheets><calcPr calcMode="auto"/></workbook>`,
        'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${packageRel}"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
        'xl/styles.xml': `<styleSheet xmlns="${main}"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.00"/></numFmts><fonts count="1"><font/></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
        'xl/worksheets/sheet1.xml': `<worksheet xmlns="${main}"><sheetFormatPr defaultRowHeight="18" defaultColWidth="9"/><cols><col min="2" max="2" width="20" customWidth="1"/></cols><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Text</t></is></c><c r="B1" s="1"><v>12.5</v></c><c r="C1"><f>SUM(B2,2)</f><v>7</v></c></row><row r="2"><c r="B2"><v>5</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="A3:B3"/></mergeCells></worksheet>`,
        'xl/worksheets/sheet2.xml': `<worksheet xmlns="${main}"><sheetData><row r="1"><c r="A1" t="b"><v>1</v></c></row></sheetData></worksheet>`,
        'customXml/item1.xml': '<vendorPayload version="3"><opaque>keep these exact bytes</opaque></vendorPayload>',
      }).map(([name, xml]) => [name, strToU8(xml)]),
    ),
  )
}

export function tableAndNoteFixture(includeTable = true, includeNote = true): Uint8Array {
  const parts = unzipSync(preservationFixture())
  const overrides: string[] = []
  const relationships: string[] = [
    '<Relationship Id="vendorPayload" Type="urn:vendor:relationships/payload" Target="../vendor/payload.bin"/>',
  ]
  const worksheetFeatures: string[] = []
  overrides.push('<Override PartName="/xl/vendor/payload.bin" ContentType="application/vnd.vendor.payload"/>')
  parts['xl/vendor/payload.bin'] = strToU8('<vendorPayload version="1">retain exact bytes</vendorPayload>')

  if (includeTable) {
    overrides.push(
      '<Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>',
    )
    relationships.push(`<Relationship Id="table1" Type="${rel}/table" Target="../tables/table1.xml"/>`)
    worksheetFeatures.push('<tableParts count="1"><tablePart r:id="table1"/></tableParts>')
    parts['xl/tables/table1.xml'] = strToU8(
      `<table xmlns="${main}" id="1" name="Orders" displayName="Orders" ref="A1:C3" totalsRowCount="1"><autoFilter ref="A1:C2"><filterColumn colId="0"><filters><filter val="Tea"/></filters></filterColumn></autoFilter><tableColumns count="3"><tableColumn id="1" name="Product"/><tableColumn id="2" name="Quantity" totalsRowFunction="sum"/><tableColumn id="3" name="Comment" totalsRowLabel="Total"/></tableColumns><tableStyleInfo name="TableStyleMedium2" showFirstColumn="1" showRowStripes="1"/></table>`,
    )
  }

  if (includeNote) {
    overrides.push(
      '<Override PartName="/xl/comments1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>',
    )
    relationships.push(
      `<Relationship Id="comments1" Type="${rel}/comments" Target="../comments1.xml"/>`,
      `<Relationship Id="vml1" Type="${rel}/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/>`,
    )
    worksheetFeatures.push('<legacyDrawing r:id="vml1"/>')
    parts['[Content_Types].xml'] = strToU8(
      strFromU8(parts['[Content_Types].xml']).replace(
        '<Default Extension="rels"',
        '<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/><Default Extension="rels"',
      ),
    )
    parts['xl/comments1.xml'] = strToU8(
      `<comments xmlns="${main}"><authors><author>Reviewer</author></authors><commentList><comment ref="D5" authorId="0"><text><r><t xml:space="preserve">Check the supplier total</t></r></text></comment></commentList></comments>`,
    )
    parts['xl/drawings/vmlDrawing1.vml'] = strToU8(
      '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><v:shape id="_x0000_s1025" type="#_x0000_t202" style="position:absolute"><x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>3, 15, 4, 0, 4, 15, 5, 0</x:Anchor><x:Row>4</x:Row><x:Column>3</x:Column></x:ClientData></v:shape></xml>',
    )
  }

  parts['[Content_Types].xml'] = strToU8(
    strFromU8(parts['[Content_Types].xml']).replace('</Types>', `${overrides.join('')}</Types>`),
  )
  parts['xl/worksheets/sheet1.xml'] = strToU8(
    strFromU8(parts['xl/worksheets/sheet1.xml'])
      .replace(`<worksheet xmlns="${main}">`, `<worksheet xmlns="${main}" xmlns:r="${rel}">`)
      .replace('</worksheet>', `${worksheetFeatures.join('')}</worksheet>`),
  )
  parts['xl/worksheets/_rels/sheet1.xml.rels'] = strToU8(
    `<Relationships xmlns="${packageRel}">${relationships.join('')}</Relationships>`,
  )
  return zipSync(parts)
}

export function nonstandardNoteRelationshipFixture(): Uint8Array {
  const parts = unzipSync(tableAndNoteFixture(false))
  parts['xl/notes/commentPayload.dat'] = parts['xl/comments1.xml']
  parts['xl/drawings/misc/legacyShape.dat'] = parts['xl/drawings/vmlDrawing1.vml']
  delete parts['xl/comments1.xml']
  delete parts['xl/drawings/vmlDrawing1.vml']

  parts['[Content_Types].xml'] = strToU8(
    strFromU8(parts['[Content_Types].xml'])
      .replace('<Override PartName="/xl/vendor/payload.bin" ContentType="application/vnd.vendor.payload"/>', '')
      .replace('/xl/comments1.xml', '/xl/notes/commentPayload.dat')
      .replace(
        '</Types>',
        '<Override PartName="/xl/drawings/misc/legacyShape.dat" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/></Types>',
      ),
  )
  parts['xl/worksheets/_rels/sheet1.xml.rels'] = strToU8(
    strFromU8(parts['xl/worksheets/_rels/sheet1.xml.rels'])
      .replace(
        '<Relationship Id="vendorPayload" Type="urn:vendor:relationships/payload" Target="../vendor/payload.bin"/>',
        '',
      )
      .replace('../comments1.xml', '../notes/./%63ommentPayload.dat')
      .replace('../drawings/vmlDrawing1.vml', '../drawings/misc/../misc/legacyShape.dat'),
  )
  delete parts['xl/vendor/payload.bin']
  return zipSync(parts)
}
