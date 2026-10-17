import { expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { importDocx } from './import'
import { exportDocxArrayBuffer } from './export'
import { defaultStyles, resolveStyle, stylesForDocument, type DocumentStyle } from '../styles'
import type { DraftDocument } from '../document-model'

it('writes styles.xml, paragraph/run references and inherited styles through two DOCX round trips', async () => {
  const custom: DocumentStyle[] = [
    {
      id: 'BodyWide',
      name: 'Body Wide',
      kind: 'paragraph',
      basedOn: 'Normal',
      next: 'Quote',
      format: {
        fontFamily: 'Tinos',
        fontSize: 16,
        color: '#334455',
        spacingBefore: 4,
        spacingAfter: 14,
        indentLeft: 12,
        indentRight: 18,
        indentFirstLine: 6,
        lineSpacing: 1.6,
        textAlign: 'center',
      },
    },
    { id: 'Detail', name: 'Detail', kind: 'paragraph', basedOn: 'BodyWide', next: 'Normal', format: { fontSize: 10 } },
    { id: 'CharBase', name: 'Character Base', kind: 'character', format: { bold: true, color: '#552233' } },
    {
      id: 'CharAccent',
      name: 'Accent',
      kind: 'character',
      basedOn: 'CharBase',
      format: { fontSize: 18, italic: true },
    },
  ]
  let document: DraftDocument = {
    type: 'doc',
    attrs: { styleDefinitions: JSON.stringify([...defaultStyles, ...custom]) },
    content: [
      {
        type: 'paragraph',
        attrs: { styleId: 'BodyWide', spacingAfter: 22 },
        content: [
          {
            type: 'text',
            text: 'Styled body',
            marks: [
              { type: 'characterStyle', attrs: { styleId: 'CharAccent' } },
              { type: 'textStyle', attrs: { fontSize: '20pt', styleBold: false } },
            ],
          },
        ],
      },
      {
        type: 'heading',
        attrs: { level: 3, styleId: 'Heading3' },
        content: [{ type: 'text', text: 'Neutral heading' }],
      },
      { type: 'paragraph', attrs: { styleId: 'Detail' }, content: [{ type: 'text', text: 'Inherited body' }] },
    ],
  }
  for (let pass = 0; pass < 2; pass++) {
    const bytes = await exportDocxArrayBuffer(document)
    const files = unzipSync(new Uint8Array(bytes))
    const xml = strFromU8(files['word/styles.xml'])
    expect(xml).toContain('w:styleId="BodyWide"')
    expect(xml).toContain('<w:basedOn w:val="BodyWide"')
    expect(xml).toContain('<w:next w:val="Quote"')
    expect(strFromU8(files['word/document.xml'])).toContain('<w:rStyle w:val="CharAccent"')
    document = importDocx(bytes).document
    const styles = stylesForDocument(document)
    for (const style of custom) expect(styles.find((entry) => entry.id === style.id)).toMatchObject(style)
    expect(resolveStyle(styles, 'Detail')).toMatchObject({
      fontSize: 10,
      fontFamily: 'Tinos',
      textAlign: 'center',
      indentLeft: 12,
    })
    expect(document.content[0].attrs).toMatchObject({ styleId: 'BodyWide', spacingAfter: 22 })
    expect(document.content[0].content?.[0].marks).toContainEqual({
      type: 'characterStyle',
      attrs: { styleId: 'CharAccent' },
    })
    expect(document.content[0].content?.[0].marks).toContainEqual({
      type: 'textStyle',
      attrs: expect.objectContaining({ fontSize: '20pt', styleBold: false }),
    })
    expect(document.content[1]).toMatchObject({ type: 'heading', attrs: { level: 3, styleId: 'Heading3' } })
  }
})

it('maps external built-in names, document defaults, basedOn, next and explicit false run properties', () => {
  const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const document = importDocx(
    zipSync({
      'word/styles.xml': strToU8(`<w:styles xmlns:w="${word}">
      <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arimo"/><w:sz w:val="26"/></w:rPr></w:rPrDefault></w:docDefaults>
      <w:style w:type="paragraph" w:styleId="Body" w:default="1"><w:name w:val="Normal"/></w:style>
      <w:style w:type="paragraph" w:styleId="Section"><w:name w:val="heading 2"/><w:basedOn w:val="Body"/><w:next w:val="Body"/><w:pPr><w:spacing w:before="240"/></w:pPr><w:rPr><w:sz w:val="40"/></w:rPr></w:style>
      <w:style w:type="paragraph" w:styleId="Child" w:customStyle="1"><w:name w:val="Section child"/><w:basedOn w:val="Section"/><w:next w:val="Body"/></w:style>
      <w:style w:type="character" w:styleId="Soft" w:customStyle="1"><w:name w:val="Soft"/><w:rPr><w:b w:val="0"/><w:i/><w:color w:val="444444"/></w:rPr></w:style>
    </w:styles>`),
      'word/document.xml': strToU8(`<w:document xmlns:w="${word}"><w:body>
      <w:p><w:pPr><w:pStyle w:val="Child"/></w:pPr><w:r><w:rPr><w:rStyle w:val="Soft"/><w:b w:val="false"/></w:rPr><w:t>Inherited</w:t></w:r></w:p>
      <w:p><w:r><w:t>Default body</w:t></w:r></w:p>
    </w:body></w:document>`),
    }),
  ).document
  const styles = stylesForDocument(document)
  expect(resolveStyle(styles, 'Child')).toMatchObject({ fontFamily: 'Arimo', fontSize: 20, spacingBefore: 12 })
  expect(resolveStyle(styles, 'Soft')).toMatchObject({ bold: false, italic: true, color: '#444444' })
  expect(styles.find((style) => style.id === 'Child')).toMatchObject({ basedOn: 'Section', next: 'Body' })
  expect(document.content[0]).toMatchObject({ type: 'heading', attrs: { level: 2, styleId: 'Child' } })
  expect(document.content[0].attrs?.spacingBefore).toBeUndefined()
  expect(document.content[1].attrs?.styleId).toBe('Body')
})
