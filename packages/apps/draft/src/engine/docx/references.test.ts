import { expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { exportDocxArrayBuffer } from './export'
import { importDocx } from './import'
import type { DraftDocument, DraftNode } from '../document-model'
import { nodeText, normalizeReferences, updateReferenceFields } from '../references'

const text = (value: string): DraftNode => ({ type: 'text', text: value })
const archive = (body: string, extra: Record<string, Uint8Array> = {}) =>
  zipSync({
    'word/document.xml': strToU8(
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}</w:body></w:document>`,
    ),
    ...extra,
  })

it('round-trips heading targets, selected bookmarks, links, TOC settings/cache, REF fields and both note types', async () => {
  const before = updateReferenceFields({
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1, anchorId: 'intro' }, content: [text('Introduction')] },
      { type: 'heading', attrs: { level: 3, anchorId: 'detail' }, content: [text('Detail')] },
      { type: 'tableOfContents', attrs: { minLevel: 1, maxLevel: 3 }, content: [] },
      {
        type: 'paragraph',
        content: [
          {
            type: 'bookmark',
            attrs: { id: 'selected', name: 'selected' },
            content: [{ ...text('Selected words'), marks: [{ type: 'bold' }] }],
          },
          { ...text('Call'), marks: [{ type: 'link', attrs: { href: 'tel:+48123456789' } }] },
          { ...text('Inside'), marks: [{ type: 'link', attrs: { href: '#intro' } }] },
          { ...text('Unsafe'), marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
          { type: 'crossReference', attrs: { targetId: 'selected', label: '' } },
          { type: 'noteReference', attrs: { id: 'n', kind: 'footnote' } },
          { type: 'noteReference', attrs: { id: 'e', kind: 'endnote' } },
        ],
      },
      {
        type: 'note',
        attrs: { id: 'n', kind: 'footnote' },
        content: [
          {
            type: 'paragraph',
            content: [
              text('A source'),
              { ...text('Mail'), marks: [{ type: 'link', attrs: { href: 'mailto:source@example.test' } }] },
            ],
          },
          { type: 'paragraph', content: [text('Second paragraph')] },
        ],
      },
      {
        type: 'note',
        attrs: { id: 'e', kind: 'endnote' },
        content: [{ type: 'paragraph', content: [text('End source')] }],
      },
    ],
  } satisfies DraftDocument)
  const bytes = await exportDocxArrayBuffer(before)
  const files = unzipSync(new Uint8Array(bytes))
  const xml = strFromU8(files['word/document.xml'])
  expect(xml).toContain('TOC \\o &quot;1-3&quot; \\h \\z \\u')
  expect(xml).toContain('REF selected \\h')
  expect(xml).toContain('w:anchor="intro"')
  expect(xml).toContain('w:footnoteReference')
  expect(strFromU8(files['word/footnotes.xml'])).toContain('w:footnoteRef')
  expect(strFromU8(files['word/endnotes.xml'])).toContain('End source')
  expect(xml).not.toContain('javascript')
  const imported = importDocx(bytes)
  expect(imported.unsupported).toEqual([])
  expect(imported.document.content[0]).toMatchObject({
    type: 'heading',
    attrs: { anchorId: 'intro' },
    content: [text('Introduction')],
  })
  const toc = imported.document.content.find((node) => node.type === 'tableOfContents')!
  expect(toc).toMatchObject(before.content[2])
  expect(toc.content?.map((node) => node.attrs?.pageNumber)).toEqual(['?', '?'])
  const paragraph = imported.document.content.find((node) => node.type === 'paragraph')!
  expect(paragraph.content?.[0]).toMatchObject({
    type: 'bookmark',
    attrs: { id: 'selected' },
    content: [{ type: 'text', text: 'Selected words', marks: [{ type: 'bold' }] }],
  })
  expect(paragraph.content).toContainEqual({
    type: 'crossReference',
    attrs: { targetId: 'selected', label: 'Selected words', format: 'text' },
  })
  expect(paragraph.content?.find((node) => node.text === 'Inside')?.marks?.[0].attrs?.href).toBe('#intro')
  expect(paragraph.content?.find((node) => node.text === 'Call')?.marks?.[0].attrs?.href).toBe('tel:+48123456789')
  const notes = imported.document.content.filter((node) => node.type === 'note')
  expect(notes.map(nodeText)).toEqual(['A sourceMailSecond paragraph', 'End source'])
  expect(notes[0].content).toHaveLength(2)
  expect(JSON.stringify(notes)).toContain('mailto:source@example.test')
  const twice = importDocx(await exportDocxArrayBuffer(imported.document))
  expect(twice.unsupported).toEqual([])
  expect(twice.document.content.find((node) => node.type === 'tableOfContents')).toEqual(toc)
  expect(twice.document.content.filter((node) => node.type === 'note').map(nodeText)).toEqual(notes.map(nodeText))
})

it('imports a standard complex Word TOC inside an SDT, retaining cached page numbers and levels', () => {
  const bytes = archive(
    `<w:sdt><w:sdtContent><w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p><w:p><w:pPr><w:pStyle w:val="TOC2"/></w:pPr><w:hyperlink w:anchor="_Toc1"><w:r><w:t>Nested heading</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>17</w:t></w:r></w:hyperlink></w:p><w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:sdtContent></w:sdt>`,
  )
  const result = importDocx(bytes)
  expect(result.unsupported).toEqual([])
  expect(result.document.content).toEqual([
    {
      type: 'tableOfContents',
      attrs: { minLevel: 1, maxLevel: 3 },
      content: [
        {
          type: 'tocEntry',
          attrs: { targetId: '_Toc1', level: 2, pageNumber: '17' },
          content: [text('Nested heading')],
        },
      ],
    },
  ])
})

it('preserves empty TOCs and imports unsupported/malformed fields as cached text with a report', async () => {
  const empty = normalizeReferences({
    type: 'doc',
    content: [{ type: 'tableOfContents', attrs: { minLevel: 2, maxLevel: 5 }, content: [] }],
  })
  expect(importDocx(await exportDocxArrayBuffer(empty)).document.content[0]).toEqual(empty.content[0])
  for (const instruction of ['TOC \\t "Custom,1"', 'TOC \\o "6-1"']) {
    const result = importDocx(
      archive(`<w:p><w:fldSimple w:instr='${instruction}'><w:r><w:t>Cached words</w:t></w:r></w:fldSimple></w:p>`),
    )
    expect(result.document.content.map(nodeText).join('')).toBe('Cached words')
    expect(result.document.content[0].type).toBe('paragraph')
    expect(result.unsupported).toContainEqual({ kind: 'TOC field (unsupported pattern)' })
  }
  const result = importDocx(archive('<w:p><w:fldSimple w:instr="PAGE"><w:r><w:t>9</w:t></w:r></w:fldSimple></w:p>'))
  expect(result.unsupported).toContainEqual({ kind: 'field' })
  expect(nodeText(result.document)).toBe('9')
})

it('imports complex REF fields and strips dangerous external relationship schemes', () => {
  const result = importDocx(
    archive(
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> REF target \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Cached reference</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:hyperlink r:id="evil"><w:r><w:t>Unsafe</w:t></w:r></w:hyperlink></w:p>',
      {
        'word/_rels/document.xml.rels': strToU8(
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="evil" Target="javascript:alert(1)" TargetMode="External" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"/></Relationships>',
        ),
      },
    ),
  )
  expect(result.document.content[0].content).toEqual([
    { type: 'crossReference', attrs: { targetId: 'target', label: 'Cached reference', format: 'text' } },
    { type: 'text', text: 'Unsafe', marks: undefined },
  ])
  expect(result.unsupported).toEqual([])
})

it('refreshes a nested TOC on export and reports mixed-field paragraphs without losing surrounding text', async () => {
  const before: DraftDocument = {
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                content: [
                  {
                    type: 'tableOfContents',
                    attrs: { minLevel: 2, maxLevel: 4 },
                    content: [
                      {
                        type: 'tocEntry',
                        attrs: { targetId: 'target', level: 3 },
                        content: [text('Cached nested entry')],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
  const imported = importDocx(await exportDocxArrayBuffer(before))
  expect(imported.unsupported).toEqual([])
  expect(imported.document.content[0].content?.[0].content?.[0].content?.[0]).toMatchObject({
    type: 'tableOfContents',
    content: [],
  })
  const mixed = importDocx(
    archive(
      '<w:p><w:r><w:t>Before </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> TOC \\o "1-3" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Cached</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t> after</w:t></w:r></w:p>',
    ),
  )
  expect(mixed.unsupported).toContainEqual({ kind: 'TOC field (unsupported pattern)' })
  expect(nodeText(mixed.document)).toBe('Before Cached after')
})
