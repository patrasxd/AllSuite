import { describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { exportDocxArrayBuffer } from './export'
import { importDocx } from './import'
import type { DraftDocument, DraftNode } from '../document-model'

function cell(text: string, attrs: DraftNode['attrs'] = {}, type = 'tableCell'): DraftNode {
  return {
    type,
    attrs: { colspan: 1, rowspan: 1, colwidth: [120], ...attrs },
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  }
}
describe('DOCX table interoperability', () => {
  it('round trips grid, horizontal/vertical merges, widths, headers, shading, borders and layout twice', async () => {
    const table: DraftNode = {
      type: 'table',
      attrs: { style: 'margin-left: auto; margin-right: auto' },
      content: [
        {
          type: 'tableRow',
          attrs: { repeatHeader: true },
          content: [
            cell(
              'Title',
              {
                colspan: 2,
                colwidth: [120, 180],
                backgroundColor: '#ffeeaa',
                verticalAlign: 'middle',
                padding: '8px',
                borderTop: '2px solid #123456',
                borderBottom: '0px none',
              },
              'tableHeader',
            ),
          ],
        },
        { type: 'tableRow', content: [cell('Tall', { rowspan: 2 }), cell('B', { colwidth: [180] })] },
        { type: 'tableRow', content: [cell('C', { colwidth: [180] })] },
      ],
    }
    let document: DraftDocument = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
        table,
        { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
      ],
    }
    for (let pass = 0; pass < 2; pass++) {
      const bytes = await exportDocxArrayBuffer(document)
      const xml = strFromU8(unzipSync(new Uint8Array(bytes))['word/document.xml'])
      expect(xml).toContain('w:tblGrid')
      expect(xml).toContain('w:gridSpan')
      expect(xml).toContain('w:vMerge')
      expect(xml).toContain('w:tblHeader')
      const imported = importDocx(bytes)
      expect(imported.unsupported).toEqual([])
      document = imported.document
      const result = document.content[1]
      expect(document.content.map((node) => node.type)).toEqual(['paragraph', 'table', 'paragraph'])
      expect(result.attrs?.style).toContain('margin-left: auto; margin-right: auto')
      expect(result.content?.[0].attrs?.repeatHeader).toBe(true)
      expect(result.content?.[0].content?.[0]).toMatchObject({
        type: 'tableHeader',
        attrs: {
          colspan: 2,
          colwidth: [120, 180],
          backgroundColor: '#ffeeaa',
          verticalAlign: 'middle',
          padding: '8px',
          borderTop: '2px solid #123456',
          borderBottom: '0px none',
        },
      })
      expect(result.content?.[1].content?.[0].attrs?.rowspan).toBe(2)
      expect(result.content?.[2].content).toHaveLength(1)
      expect(result.content?.[2].content?.[0].content?.[0].content?.[0].text).toBe('C')
    }
  })
  it('imports external table borders, grid and vMerge continuation with omitted val', () => {
    const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="12" w:color="FF0000"/><w:insideH w:val="nil"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="1800"/><w:gridCol w:w="2700"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p/></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl></w:body></w:document>`
    const table = importDocx(zipSync({ 'word/document.xml': strToU8(xml) })).document.content[0]
    expect(table.content?.[0].content?.[0].attrs).toMatchObject({
      rowspan: 2,
      colwidth: [120],
      borderTop: '2px solid #ff0000',
    })
    expect(table.content?.[1].content).toHaveLength(1)
  })
  it('stores visual header rows separately from repeat-header behavior', async () => {
    const result = importDocx(
      await exportDocxArrayBuffer({
        type: 'doc',
        content: [
          {
            type: 'table',
            content: [
              { type: 'tableRow', attrs: { repeatHeader: false }, content: [cell('Header', {}, 'tableHeader')] },
            ],
          },
        ],
      }),
    )
    expect(result.document.content[0].content?.[0]).toMatchObject({
      attrs: { repeatHeader: false },
      content: [{ type: 'tableHeader' }],
    })
  })
})
