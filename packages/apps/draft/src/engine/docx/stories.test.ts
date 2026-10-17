import { expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { emptyStories, formatPage, resolveStory, storyLayout, storyVariant, validateStories } from '../stories'
import { DEFAULT_PAGE_SETUP, readPageSetup } from '../page-setup'
import { exportDocxArrayBuffer } from './export'
import { importDocx } from './import'
import type { DraftDocument } from '../document-model'
import { nodeText } from '../references'

const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
it.each(['decimal', 'lowerRoman', 'upperRoman'] as const)(
  'round trips all six rich stories, fields and %s numbering twice',
  async (format) => {
    const stories = emptyStories()
    Object.assign(stories, {
      differentFirst: true,
      differentEven: true,
      start: 7,
      format,
      title: 'Zażółć <title> & friends',
    })
    for (const kind of ['header', 'footer'] as const)
      for (const variant of ['default', 'first', 'even'] as const)
        stories[kind][variant] = [
          {
            type: 'paragraph',
            attrs: { textAlign: 'right' },
            content: [
              {
                type: 'text',
                text: `${kind}:${variant} 2026-10-16`,
                marks: [
                  { type: 'bold' },
                  { type: 'italic' },
                  { type: 'underline' },
                  { type: 'textStyle', attrs: { fontFamily: 'Tinos', fontSize: '14pt', color: '#123456' } },
                ],
              },
              { type: 'storyField', attrs: { field: 'PAGE' }, marks: [{ type: 'bold' }] },
              { type: 'text', text: ' / ' },
              { type: 'storyField', attrs: { field: 'NUMPAGES' } },
              { type: 'storyField', attrs: { field: 'TITLE' } },
              { type: 'hardBreak' },
              {
                type: 'image',
                attrs: { src: png, width: 40, height: 30, alt: '<logo>', alignment: 'inline', wrap: 'inline' },
              },
            ],
          },
          { type: 'paragraph', content: [{ type: 'text', text: 'Second line' }] },
        ]
    let doc: DraftDocument = {
      type: 'doc',
      attrs: { pageSetup: JSON.stringify({ ...DEFAULT_PAGE_SETUP, stories }) },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }],
    }
    for (let round = 0; round < 2; round++) {
      const bytes = await exportDocxArrayBuffer(doc)
      const files = unzipSync(new Uint8Array(bytes))
      expect(strFromU8(files['word/document.xml'])).toContain('w:titlePg')
      expect(strFromU8(files['word/settings.xml'])).toContain('w:evenAndOddHeaders')
      const parts = Object.keys(files).filter((path) => /^word\/(?:header|footer)\d+\.xml$/.test(path))
      expect(parts).toHaveLength(6)
      for (const path of parts) {
        const xml = strFromU8(files[path])
        expect(xml).toContain('w:instr="PAGE"')
        expect(xml).toContain('w:instr="NUMPAGES"')
        expect(xml).toContain('w:drawing')
      }
      const result = importDocx(bytes)
      expect(result.unsupported).toEqual([])
      const imported = readPageSetup(result.document).stories!
      expect(imported).toMatchObject({
        differentFirst: true,
        differentEven: true,
        start: 7,
        format,
        title: stories.title,
      })
      for (const kind of ['header', 'footer'] as const)
        for (const variant of ['default', 'first', 'even'] as const) {
          const content = imported[kind][variant][0].content!
          expect(content[0].text).toBe(`${kind}:${variant} 2026-10-16`)
          expect(content[0].marks).toEqual(expect.arrayContaining(stories[kind][variant][0].content![0].marks!))
          expect(content[1]).toMatchObject({ type: 'storyField', attrs: { field: 'PAGE' }, marks: [{ type: 'bold' }] })
          expect(content.find((node) => node.type === 'image')?.attrs).toMatchObject({
            src: png,
            width: 40,
            height: 30,
            alt: '<logo>',
          })
          expect(imported[kind][variant][1].content?.[0].text).toBe('Second line')
        }
      doc = result.document
    }
  },
)

it('imports complex PAGE and NUMPAGES instructions without keeping cached numeric text', () => {
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const result = importDocx(
    zipSync({
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${w}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p/><w:sectPr><w:headerReference w:type="default" r:id="h"/></w:sectPr></w:body></w:document>`,
      ),
      'word/_rels/document.xml.rels': strToU8(
        '<Relationships><Relationship Id="h" Target="header1.xml"/></Relationships>',
      ),
      'word/header1.xml': strToU8(
        `<w:hdr xmlns:w="${w}"><w:p>${['PAGE', 'NUMPAGES'].map((field) => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>${field} \\* MERGEFORMAT</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>999</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`).join('')}</w:p></w:hdr>`,
      ),
    }),
  )
  expect(result.unsupported).toEqual([])
  const s = readPageSetup(result.document).stories!
  expect(s.header.default[0].content?.map((node) => node.attrs?.field)).toEqual(['PAGE', 'NUMPAGES'])
  expect(nodeText(resolveStory(s.header.default, s, 2, 12))).toBe('212')
})

it('uses physical parity, first-page precedence and bounded Roman numbering', () => {
  const s = { ...emptyStories(), differentFirst: true, differentEven: true, start: 8 }
  expect([1, 2, 3, 4].map((page) => storyVariant(s, page))).toEqual(['first', 'even', 'default', 'even'])
  expect(formatPage(49, 'lowerRoman')).toBe('xlix')
  expect(formatPage(1999, 'upperRoman')).toBe('MCMXCIX')
  expect(formatPage(4000, 'upperRoman')).toBe('4000')
  const layout = storyLayout(DEFAULT_PAGE_SETUP, 5000, 10000)
  expect(DEFAULT_PAGE_SETUP.height / 15 - layout.top - layout.bottom).toBeCloseTo(96)
  expect(layout.headerScale).toBeLessThan(1)
  expect(storyLayout(DEFAULT_PAGE_SETUP, 100, 60).top).toBeGreaterThan(DEFAULT_PAGE_SETUP.top / 15)
  expect(validateStories({ ...s, start: 0 })).toBeNull()
  s.header.default = [
    { type: 'paragraph', content: [{ type: 'image', attrs: { src: 'https://example.com/track.png' } }] },
  ]
  expect(validateStories(s)).toBeNull()
})
