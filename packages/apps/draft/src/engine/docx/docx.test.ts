import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
  TabStopType,
  UnderlineType,
} from 'docx'
import { zipSync, strToU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import { exportDocxArrayBuffer } from './export'
import { importDocx } from './import'

async function fixture() {
  const document = new Document({
    styles: { default: { document: { run: { language: { value: 'pl-PL' } } } } },
    sections: [
      {
        properties: { column: { count: 2, equalWidth: true } },
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Heading')] }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 240, line: 360 },
            indent: { left: 240, right: 360, firstLine: 120 },
            tabStops: [{ type: TabStopType.LEFT, position: 1440 }],
            children: [
              new TextRun({
                text: 'Styled',
                bold: true,
                italics: true,
                underline: { type: UnderlineType.SINGLE },
                strike: true,
                color: 'FF0000',
                highlight: 'yellow',
                size: 28,
                font: 'Arial',
              }),
              new TextRun({ text: ' sub', subScript: true }),
              new TextRun({ text: ' sup', superScript: true }),
              new TextRun({ text: ' first', break: 1 }),
              new TextRun({ text: 'second\twith tab' }),
              new ExternalHyperlink({ link: 'https://example.test', children: [new TextRun(' link')] }),
            ],
          }),
          new Paragraph({ text: 'Bullet', bullet: { level: 0 } }),
          new Paragraph({ text: 'Numbered', numbering: { reference: 'numbered', level: 0 } }),
        ],
      },
    ],
    numbering: {
      config: [
        {
          reference: 'numbered',
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT }],
        },
      ],
    },
  })
  return Packer.toArrayBuffer(document)
}

describe('DOCX reader and writer', () => {
  it('reads supported direct formatting, paragraph properties, headings and lists', async () => {
    const imported = importDocx(await fixture())
    expect(imported.document.content[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } })
    expect(imported.document.attrs).toMatchObject({ columns: 2 })
    expect(imported.language).toBe('pl-PL')
    const styled = imported.document.content[1]
    expect(styled.attrs).toMatchObject({
      textAlign: 'center',
      spacingBefore: 6,
      spacingAfter: 12,
      lineSpacing: 1.5,
      indentLeft: 12,
      indentRight: 18,
      indentFirstLine: 6,
      tabStops: [72],
    })
    expect(styled.content?.[0].marks).toEqual(
      expect.arrayContaining([
        { type: 'bold' },
        { type: 'italic' },
        { type: 'underline' },
        { type: 'strike' },
        { type: 'highlight', attrs: { color: '#ffff00' } },
      ]),
    )
    expect(styled.content?.[0].marks).toContainEqual({
      type: 'textStyle',
      attrs: expect.objectContaining({ fontFamily: 'Arial' }),
    })
    expect(styled.content?.some((node) => node.type === 'hardBreak')).toBe(true)
    expect(imported.document.content.some((node) => node.type === 'bulletList')).toBe(true)
    expect(imported.document.content.some((node) => node.type === 'orderedList')).toBe(true)
  })

  it('round-trips text and supported formatting through the DOCX exporter', async () => {
    const before = importDocx(await fixture()).document
    const after = importDocx(await exportDocxArrayBuffer(before, 'en-US')).document
    expect(after.content.map((node) => node.type)).toEqual(before.content.map((node) => node.type))
    expect(JSON.stringify(after)).toContain('Styled')
    expect(JSON.stringify(after)).toContain('Heading')
    expect(JSON.stringify(after)).toContain('bold')
    expect(JSON.stringify(after)).toContain('bulletList')
    expect(after.content[1].attrs).toMatchObject(before.content[1].attrs || {})
    expect(after.attrs).toMatchObject({ columns: 2 })
    expect(JSON.stringify(after)).toContain('Arial')
  })

  it('round-trips hanging indents, right indents and tab stops', async () => {
    const before = importDocx(await fixture()).document
    before.attrs = { columns: 3 }
    before.content[1].attrs = {
      ...before.content[1].attrs,
      indentFirstLine: null,
      indentHanging: 9,
      indentRight: 18,
      tabStops: [72, 144],
    }
    const after = importDocx(await exportDocxArrayBuffer(before, 'en-US')).document
    expect(after.attrs).toMatchObject({ columns: 3 })
    expect(after.content[1].attrs).toMatchObject({
      indentHanging: 9,
      indentRight: 18,
      tabStops: [72, 144],
    })
  })

  it('reports unsupported OOXML and handles corrupted or empty archives', () => {
    const unsupported = zipSync({
      'word/document.xml': strToU8(
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p><w:commentRangeStart/><w:drawing><w:chart/></w:drawing></w:body></w:document>',
      ),
      'word/vbaProject.bin': new Uint8Array([1]),
    })
    expect(importDocx(unsupported).unsupported.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['chart — could not be rendered', 'comment', 'macro']),
    )
    expect(() => importDocx(new Uint8Array([1, 2, 3]))).toThrow(/valid DOCX/i)
    expect(() => importDocx(zipSync({}))).toThrow(/document.xml/i)
  })

  it('accepts a five megabyte document payload for the worker parser', () => {
    const text = 'x'.repeat(5 * 1024 * 1024)
    const archive = zipSync({
      'word/document.xml': strToU8(
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
      ),
    })
    expect(importDocx(archive).document.content[0].content?.[0].text).toHaveLength(text.length)
  })
})
