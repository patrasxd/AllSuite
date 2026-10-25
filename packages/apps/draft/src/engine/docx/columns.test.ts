import { expect, it } from 'vitest'
import { Document, Packer, Paragraph } from 'docx'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { exportDocxArrayBuffer } from './export'
import { importDocx } from './import'
import { DEFAULT_PAGE_SETUP } from '../page-setup'

it('preserves authored equal-width columns, geometry, stories and page breaks through DOCX', async () => {
  for (const columns of [2, 3]) {
    const page = {
      ...DEFAULT_PAGE_SETUP,
      width: 15840,
      height: 12240,
      orientation: 'landscape' as const,
      left: 900,
      headerText: 'Column report',
      pageNumbers: true,
    }
    const before = {
      type: 'doc' as const,
      attrs: { columns, pageSetup: JSON.stringify(page) },
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Heading' }] },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Before' }, { type: 'pageBreak' }, { type: 'text', text: 'After' }],
        },
      ],
    }
    const bytes = await exportDocxArrayBuffer(before, 'en-US')
    const files = unzipSync(new Uint8Array(bytes))
    const xml = strFromU8(files['word/document.xml'])
    expect(xml).toMatch(new RegExp(`<w:cols[^>]*w:num="${columns}"`))
    expect(xml).toContain('w:space="480"')
    expect(xml).toContain('w:type="page"')
    const after = importDocx(bytes)
    expect(after.document.attrs?.columns).toBe(columns)
    expect(JSON.parse(String(after.document.attrs?.pageSetup))).toMatchObject({
      width: 15840,
      height: 12240,
      left: 900,
      orientation: 'landscape',
    })
    expect(JSON.stringify(after.document)).toContain('Column report')
    expect(JSON.stringify(after.document)).toContain('pageBreak')
    expect(after.unsupported.some((item) => item.kind === 'pageSetupColumns')).toBe(false)
  }
})

it('reports unsupported imported column definitions rather than silently claiming preservation', async () => {
  const original = new Uint8Array(
    await Packer.toArrayBuffer(new Document({ sections: [{ children: [new Paragraph('External layout')] }] })),
  )
  for (const definition of [
    '<w:cols w:num="2" w:space="720"/>',
    '<w:cols w:num="2" w:equalWidth="0"><w:col w:w="2000"/><w:col w:w="4000"/></w:cols>',
    '<w:cols w:num="4"/>',
  ]) {
    const files = unzipSync(original)
    files['word/document.xml'] = strToU8(
      strFromU8(files['word/document.xml']).replace('</w:sectPr>', definition + '</w:sectPr>'),
    )
    const result = importDocx(zipSync(files).buffer as ArrayBuffer)
    expect(result.unsupported).toContainEqual({ kind: 'pageSetupColumns' })
    expect(JSON.stringify(result.document)).toContain('External layout')
  }
})
