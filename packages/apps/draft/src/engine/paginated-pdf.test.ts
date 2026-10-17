import { it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFHexString } from 'pdf-lib'
import { exportPaginatedPDF } from './paginated-pdf'
import { printLayoutHTML, type PrintLayout } from './print-layout'
import type { ExportFont } from './export/model'
it('embeds local WOFF subsets, including Polish composite glyphs, and creates heading outlines', async () => {
  const fonts: ExportFont[] = ['latin', 'latin-ext'].map((subset) => ({
    family: 'Arimo',
    weight: 400,
    style: 'normal',
    subset: subset as ExportFont['subset'],
    source:
      'data:font/woff;base64,' +
      readFileSync(`node_modules/@fontsource/arimo/files/arimo-${subset}-400-normal.woff`).toString('base64'),
  }))
  const bytes = await exportPaginatedPDF(
    {
      width: 794,
      height: 1123,
      title: 'Synthetic title',
      language: 'pl',
      destinations: {},
      headings: [{ title: 'Heading', level: 1, page: 0, x: 50, y: 80 }],
      pages: [
        {
          links: [],
          items: [
            {
              kind: 'text',
              text: 'ąćęłńśźż',
              x: 50,
              y: 80,
              width: 100,
              height: 20,
              baseline: 96,
              family: 'Arimo',
              size: 16,
              bold: false,
              italic: false,
              color: '#202020',
            },
          ],
        },
      ],
    },
    fonts,
  )
  const document = await PDFDocument.load(bytes)
  expect(document.getPageCount()).toBe(1)
  expect(document.getTitle()).toBe('Synthetic title')
  expect(document.catalog.has(PDFName.of('Outlines'))).toBe(true)
})

const layout = (): PrintLayout => ({
  width: 600,
  height: 800,
  title: 'Zażółć <script>alert(1)</script>',
  language: 'pl',
  destinations: { destination: { page: 1, x: 50, y: 100 } },
  headings: [
    { title: 'First', level: 1, page: 0, x: 50, y: 50 },
    { title: 'Nested', level: 2, page: 1, x: 50, y: 100 },
    { title: 'Last', level: 1, page: 1, x: 50, y: 200 },
  ],
  pages: [
    {
      items: [],
      links: [
        { x: 10, y: 20, width: 40, height: 20, href: '#destination' },
        { x: 20, y: 40, width: 40, height: 20, href: 'https://example.test' },
        { x: 30, y: 60, width: 40, height: 20, href: 'javascript:alert(1)' },
      ],
    },
    { items: [], links: [] },
  ],
})
it('writes hierarchical Unicode bookmarks and safe internal/external link annotations without changing input', async () => {
  const input = layout(),
    before = JSON.stringify(input)
  const pdf = await PDFDocument.load(await exportPaginatedPDF(input, []))
  expect(pdf.getPage(0).getWidth()).toBe(450)
  const annotations = pdf.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray)
  expect(annotations.size()).toBe(2)
  expect(pdf.context.lookup(annotations.get(0), PDFDict).has(PDFName.of('Dest'))).toBe(true)
  const root = pdf.catalog.lookup(PDFName.of('Outlines'), PDFDict),
    first = pdf.context.lookup(root.get(PDFName.of('First'))!, PDFDict)
  const nested = pdf.context.lookup(first.get(PDFName.of('First'))!, PDFDict)
  expect((nested.get(PDFName.of('Title')) as PDFHexString).decodeText()).toBe('Nested')
  expect(first.has(PDFName.of('Next'))).toBe(true)
  expect(JSON.stringify(input)).toBe(before)
})
it('cancels a PDF before any page content is generated', async () => {
  const abort = new AbortController()
  abort.abort()
  await expect(exportPaginatedPDF(layout(), [], abort.signal)).rejects.toMatchObject({ name: 'AbortError' })
})
it('serializes fixed physical pages with zero print margins and escaped, script-free title metadata', () => {
  const html = printLayoutHTML(layout(), [])
  expect(html).toContain('@page{size:450pt 600pt;margin:0}')
  expect(html).toContain('<title>Zażółć &lt;script&gt;')
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('javascript:')
  expect(html.match(/class="print-sheet"/g)).toHaveLength(2)
  expect(html).toContain('break-after:page')
})
