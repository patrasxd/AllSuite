import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { DraftDocument, DraftNode } from '../document-model'
import { DEFAULT_PAGE_SETUP } from '../page-setup'
import { defaultStyles } from '../styles'
import { exportOdt } from './export'
import { importOdt } from './import'

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0])
const text = (value: string, marks?: DraftNode['marks']): DraftNode => ({ type: 'text', text: value, marks })
const paragraph = (value: string): DraftNode => ({ type: 'paragraph', content: [text(value)] })
const sample: DraftDocument = {
  type: 'doc',
  attrs: {
    columns: 1,
    pageSetup: JSON.stringify({ ...DEFAULT_PAGE_SETUP, left: 1100, right: 1200 }),
    styleDefinitions: JSON.stringify(defaultStyles),
  },
  content: [
    { type: 'heading', attrs: { level: 1, styleId: 'Heading1', anchorId: 'overview' }, content: [text('Overview')] },
    {
      type: 'paragraph',
      content: [
        text('Bold and underlined', [{ type: 'bold' }, { type: 'underline' }]),
        text('  text with spaces and a ', []),
        text('safe link', [{ type: 'link', attrs: { href: 'https://example.test/odt' } }]),
      ],
    },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [paragraph('One')] },
        { type: 'listItem', content: [paragraph('Two')] },
      ],
    },
    {
      type: 'orderedList',
      content: [
        { type: 'listItem', content: [paragraph('First')] },
        { type: 'listItem', content: [paragraph('Second')] },
      ],
    },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [paragraph('Key')] },
            { type: 'tableHeader', content: [paragraph('Value')] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [paragraph('Name')] },
            { type: 'tableCell', content: [paragraph('Draft')] },
          ],
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'image',
          attrs: {
            src: `data:image/png;base64,${btoa(String.fromCharCode(...png))}`,
            width: 96,
            height: 48,
            alt: 'A small test image',
            alignment: 'inline',
            wrap: 'inline',
          },
        },
      ],
    },
  ],
}

function textParts(node: DraftNode): string[] {
  if (node.type === 'text') return [node.text || '']
  return (node.content || []).flatMap(textParts)
}

describe('ODT import and export', () => {
  it('round-trips headings, inline formatting, links, lists, tables, images, styles, language, and page setup', () => {
    const bytes = exportOdt(sample, 'pl-PL')
    const files = unzipSync(bytes)
    expect(Object.keys(files)[0]).toBe('mimetype')
    expect(strFromU8(files.mimetype)).toBe('application/vnd.oasis.opendocument.text')
    const contentXml = strFromU8(files['content.xml'])
    expect(contentXml).toContain('<text:h')
    expect(contentXml).toContain('<table:table')
    expect(contentXml).toContain('Pictures/image-1.png')

    const imported = importOdt(bytes)
    expect(imported.unsupported).toEqual([])
    expect(imported.language).toBe('pl-PL')
    expect(textParts(imported.document).join('')).toBe(textParts(sample).join(''))
    expect(imported.document.content[0]).toMatchObject({ type: 'heading', attrs: { level: 1, anchorId: 'overview' } })
    expect(imported.document.content[1].content?.[0].marks?.map((mark) => mark.type)).toEqual(
      expect.arrayContaining(['bold', 'underline']),
    )
    expect(imported.document.content.some((node) => node.type === 'bulletList')).toBe(true)
    expect(imported.document.content.some((node) => node.type === 'orderedList')).toBe(true)
    expect(imported.document.content.find((node) => node.type === 'table')?.content?.[0].content?.[0].type).toBe(
      'tableHeader',
    )
    const image = imported.document.content
      .flatMap((node) => node.content || [])
      .find((child) => child.type === 'image')
    expect(image).toMatchObject({ attrs: { width: 96, height: 48, alt: 'A small test image' } })
    expect(imported.document.attrs?.pageSetup).toContain('"left":1100')
  })

  it('reports unsupported ODT content through the shared import result', () => {
    const files = unzipSync(exportOdt(sample))
    const xml = strFromU8(files['content.xml']).replace(
      '</office:text>',
      '<text:tracked-changes/><draw:object/></office:text>',
    )
    files['content.xml'] = strToU8(xml)
    const result = importOdt(zipSync(files, { level: 0 }))
    expect(result.unsupported.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['tracked changes (not supported in ODT)', 'object (not supported in ODT)']),
    )
  })

  it('rejects invalid ODT archives', () => {
    expect(() => importOdt(Uint8Array.from([1, 2, 3]))).toThrow()
    expect(() => importOdt(zipSync({ 'styles.xml': strToU8('<office:document-styles/>') }))).toThrow(/content.xml/i)
  })
})
