import { describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { exportDocxArrayBuffer } from './export'
import { importDocx } from './import'
import { DEFAULT_PAGE_SETUP, orientPage, presetPage, readPageSetup } from '../page-setup'
import type { DraftDocument } from '../document-model'
import { storiesFor, resolveStory } from '../stories'
import { nodeText } from '../references'

describe('DOCX page setup', () => {
  it.each(['a4', 'a5', 'letter', 'legal', 'custom'])(
    'round trips %s dimensions, margins, stories, counters and page breaks twice',
    async (preset) => {
      const page = {
        ...orientPage(presetPage({ ...DEFAULT_PAGE_SETUP }, preset), 'landscape'),
        top: 1400,
        left: 800,
        right: 900,
        bottom: 1500,
        header: 500,
        footer: 600,
        headerText: 'Zażółć < & " ',
        footerText: 'Stopka  ',
        pageNumbers: true,
      }
      if (preset === 'custom') {
        page.width = 15000
        page.height = 13000
      }
      let doc: DraftDocument = {
        type: 'doc',
        attrs: { pageSetup: JSON.stringify(page) },
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Before' }, { type: 'pageBreak' }, { type: 'text', text: 'After' }],
          },
          {
            type: 'paragraph',
            attrs: { pageBreakBefore: 1, keepNext: true, keepLines: true, widowControl: false },
            content: [{ type: 'text', text: 'Next page' }],
          },
        ],
      }
      for (let i = 0; i < 2; i++) {
        const bytes = await exportDocxArrayBuffer(doc)
        const xml = strFromU8(unzipSync(new Uint8Array(bytes))['word/document.xml'])
        expect(xml).toContain(`w:w="${page.width}"`)
        expect(xml).toContain(`w:h="${page.height}"`)
        const result = importDocx(bytes)
        expect(result.unsupported).toEqual([])
        const imported = readPageSetup(result.document)
        expect(imported).toMatchObject({ ...page, headerText: '', footerText: '', pageNumbers: false })
        const stories = storiesFor(imported)
        expect(nodeText(resolveStory(stories.header.default, stories, 1, 5))).toBe(page.headerText)
        expect(nodeText(resolveStory(stories.footer.default, stories, 1, 5))).toBe(`${page.footerText}  1 / 5`)
        expect(JSON.stringify(result.document)).toContain('pageBreak')
        expect(result.document.content[1].attrs?.pageBreakBefore).toBe(1)
        expect(result.document.content[1].attrs).toMatchObject({ keepNext: true, keepLines: true, widowControl: false })
        doc = result.document
      }
    },
  )
  it('imports Roman restarts and rich stories while reporting unsupported geometry and missing parts', () => {
    const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:pPr><w:sectPr><w:type w:val="continuous"/><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/><w:pgMar w:top="1200" w:right="1000" w:bottom="1200" w:left="1000" w:gutter="300"/><w:pgNumType w:start="5" w:fmt="upperRoman"/><w:titlePg/><w:headerReference w:type="default" r:id="head"/><w:footerReference w:type="even" r:id="missing"/></w:sectPr></w:pPr><w:r><w:t>Text</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`
    const result = importDocx(
      zipSync({
        'word/document.xml': strToU8(xml),
        'word/settings.xml': strToU8(
          '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:mirrorMargins/></w:settings>',
        ),
        'word/_rels/document.xml.rels': strToU8(
          '<Relationships><Relationship Id="head" Target="header1.xml"/></Relationships>',
        ),
        'word/header1.xml': strToU8(
          '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Formatted</w:t></w:r></w:p></w:hdr>',
        ),
      }),
    )
    expect(result.unsupported.map((item) => item.kind)).toEqual(
      expect.arrayContaining([
        'pageSetupMultipleSections',
        'pageSetupGutter',
        'pageSetupMirrored',
        'pageSetupSectionBreak',
        'pageSetupStories',
      ]),
    )
    expect(readPageSetup(result.document).width).toBe(15840)
    expect(readPageSetup(result.document).headerText).toBe('')
    expect(readPageSetup(result.document).stories).toMatchObject({
      start: 5,
      format: 'upperRoman',
      differentFirst: true,
    })
    expect(readPageSetup(result.document).stories?.header.default[0].content?.[0].marks).toContainEqual({
      type: 'bold',
    })
  })
  it('reports and replaces invalid physical geometry without retaining negative body space', () => {
    const result = importDocx(
      zipSync({
        'word/document.xml': strToU8(
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/><w:sectPr><w:pgSz w:w="1" w:h="2"/></w:sectPr></w:body></w:document>',
        ),
      }),
    )
    expect(result.unsupported).toContainEqual({ kind: 'pageSetupInvalid' })
    expect(readPageSetup(result.document)).toEqual(DEFAULT_PAGE_SETUP)
  })
})
