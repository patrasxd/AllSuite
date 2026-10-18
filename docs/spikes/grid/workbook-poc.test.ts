import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

const parser = new DOMParser()
const serializer = new XMLSerializer()
const opaquePath = 'customXml/item1.xml'
const opaqueContent = '<opaque vendor="example"><keep bytes="verbatim"/></opaque>'

function fixture(): Uint8Array {
  const parts: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Input" sheetId="1" r:id="rId1"/><sheet name="Calc" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId4" Type="urn:example:opaque" Target="../customXml/item1.xml"/></Relationships>`,
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" s="1" t="inlineStr"><is><t>Label</t></is></c></row><row r="2"><c r="A2"><v>5</v></c><c r="B2"><f>A2*2</f><v>10</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells></worksheet>`,
    ),
    'xl/worksheets/sheet2.xml': strToU8(
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Second sheet</t></is></c></row></sheetData></worksheet>`,
    ),
    'xl/styles.xml': strToU8(
      `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="center"/></xf></cellXfs></styleSheet>`,
    ),
    'customXml/item1.xml': strToU8(opaqueContent),
    'customXml/item2.xml': strToU8(`<opaque-properties owner="item1"/>`),
    'customXml/_rels/item1.xml.rels': strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdOpaque" Type="urn:example:opaque-properties" Target="item2.xml"/></Relationships>`,
    ),
  }
  return zipSync(parts)
}

function xmlPart(parts: Record<string, Uint8Array>, path: string) {
  return parser.parseFromString(strFromU8(parts[path]!), 'application/xml')
}

function valueOf(parts: Record<string, Uint8Array>, path: string, cellRef: string): string | null {
  const document = xmlPart(parts, path)
  const cell = Array.from(document.getElementsByTagName('c')).find((node) => node.getAttribute('r') === cellRef)
  return cell?.getElementsByTagName('v')[0]?.textContent ?? null
}

function patchCellValue(parts: Record<string, Uint8Array>, path: string, cellRef: string, value: string) {
  const document = xmlPart(parts, path)
  const cell = Array.from(document.getElementsByTagName('c')).find((node) => node.getAttribute('r') === cellRef)
  if (!cell) throw new Error(`Missing cell ${cellRef}`)
  const valueNode = cell.getElementsByTagName('v')[0]
  if (!valueNode) throw new Error(`Missing cached value for ${cellRef}`)
  valueNode.textContent = value
  parts[path] = strToU8(serializer.serializeToString(document))
}

function sheetNames(parts: Record<string, Uint8Array>): string[] {
  return Array.from(xmlPart(parts, 'xl/workbook.xml').getElementsByTagName('sheet')).map(
    (sheet) => sheet.getAttribute('name') ?? '',
  )
}

describe('raw OOXML ZIP preservation proof', () => {
  it('opens, edits, saves and reopens a workbook while retaining opaque ZIP parts', () => {
    const opened = unzipSync(fixture())
    expect(sheetNames(opened)).toEqual(['Input', 'Calc'])
    const inputSheet = xmlPart(opened, 'xl/worksheets/sheet1.xml')
    const styledLabel = Array.from(inputSheet.getElementsByTagName('c')).find((cell) => cell.getAttribute('r') === 'A1')
    expect(styledLabel?.getAttribute('s')).toBe('1')
    expect(inputSheet.getElementsByTagName('mergeCell')[0]?.getAttribute('ref')).toBe('A1:B1')
    expect(valueOf(opened, 'xl/worksheets/sheet1.xml', 'B2')).toBe('10')

    patchCellValue(opened, 'xl/worksheets/sheet1.xml', 'A2', '7')
    patchCellValue(opened, 'xl/worksheets/sheet1.xml', 'B2', '14')
    const saved = zipSync(opened)
    const reopened = unzipSync(saved)

    expect(sheetNames(reopened)).toEqual(['Input', 'Calc'])
    expect(valueOf(reopened, 'xl/worksheets/sheet1.xml', 'A2')).toBe('7')
    expect(valueOf(reopened, 'xl/worksheets/sheet1.xml', 'B2')).toBe('14')
    const reopenedSheet = xmlPart(reopened, 'xl/worksheets/sheet1.xml')
    expect(reopenedSheet.getElementsByTagName('c')[2]?.getElementsByTagName('f')[0]?.textContent).toBe('A2*2')
    expect(reopenedSheet.getElementsByTagName('mergeCell')[0]?.getAttribute('ref')).toBe('A1:B1')
    expect(
      Array.from(reopenedSheet.getElementsByTagName('c'))
        .find((cell) => cell.getAttribute('r') === 'A1')
        ?.getAttribute('s'),
    ).toBe('1')
    expect(strFromU8(reopened[opaquePath]!)).toBe(opaqueContent)
    expect(strFromU8(reopened['customXml/item2.xml']!)).toBe(`<opaque-properties owner="item1"/>`)
    expect(strFromU8(reopened['customXml/_rels/item1.xml.rels']!)).toContain('rIdOpaque')
    expect(strFromU8(reopened['xl/_rels/workbook.xml.rels']!)).toContain('rId4')
  })
})
