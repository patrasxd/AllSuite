import { expect, test } from '@playwright/test'
import type { Editor } from '@tiptap/core'
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFHexString } from 'pdf-lib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { inspectPDF } from './fixtures/render-pdf'
import { generatedPNG } from './fixtures/png'

test('Ctrl+P refreshes visible TOC caches in a separate undo event and preserves the caret', async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    window.print = () => {
      document.documentElement.dataset.printRequested = 'true'
    }
  })
  await page.goto('./#/draft')
  const body = page.locator('.draft-paper .tiptap')
  await body.waitFor()
  await body.evaluate((element) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { anchorId: 'intro', level: 1 },
          content: [{ type: 'text', text: 'Current introduction' }],
        },
        {
          type: 'tableOfContents',
          attrs: { minLevel: 1, maxLevel: 3 },
          content: [
            {
              type: 'tocEntry',
              attrs: { targetId: 'intro', level: 1, pageNumber: '99' },
              content: [{ type: 'text', text: 'Stale cache' }],
            },
          ],
        },
        {
          type: 'heading',
          attrs: { anchorId: 'conclusion', level: 1, pageBreakBefore: 1 },
          content: [{ type: 'text', text: 'Conclusion' }],
        },
      ],
    })
    editor.commands.setTextSelection(3)
  })
  const before = await body.evaluate((element) =>
    JSON.stringify((element as HTMLElement & { editor: Editor }).editor.getJSON()),
  )
  const opening = page.waitForEvent('popup')
  await body.press('Control+p')
  const print = await opening
  await expect(print.locator('html')).toHaveAttribute('data-print-requested', 'true')
  await expect(body.locator('.draft-toc-label')).toHaveText(['Current introduction', 'Conclusion'])
  await expect(body.locator('.draft-toc-page')).toHaveText(['1', '2'])
  expect(
    await body.evaluate((element) => (element as HTMLElement & { editor: Editor }).editor.state.selection.from),
  ).toBe(3)
  await expect(print.locator('.print-sheet')).toHaveCount(await page.locator('.draft-sheet').count())
  await print.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await body.press('Control+z')
  expect(
    await body.evaluate((element) => JSON.stringify((element as HTMLElement & { editor: Editor }).editor.getJSON())),
  ).toBe(before)
})

for (const [name, width, height, kind] of [
  ['a4-long-paragraph', 11906, 16838, 'paragraph'],
  ['a5-tables-images', 8391, 11906, 'table'],
  ['letter-rich-stories', 12240, 15840, 'paragraph'],
  ['legal-tables', 12240, 20160, 'table'],
  ['custom-landscape', 13606, 10205, 'table'],
] as const)
  test(`physical pages match for ${name}`, async ({ page, context }) => {
    test.setTimeout(60000)
    await context.addInitScript(() => {
      window.print = () => {
        document.documentElement.dataset.printRequested = 'true'
      }
    })
    await page.goto('./#/draft')
    const body = page.locator('.draft-paper .tiptap')
    await body.waitFor()
    await body.evaluate(
      (element, { width, height, kind, png }) => {
        const editor = (element as HTMLElement & { editor: Editor }).editor
        const setup = JSON.parse(editor.state.doc.attrs.pageSetup)
        Object.assign(setup, {
          width,
          height,
          orientation: width > height ? 'landscape' : 'portrait',
          top: 1000,
          bottom: 1100,
          left: 900,
          right: 1100,
        })
        const p = (text: string) => ({
          type: 'paragraph',
          content: [{ type: 'text', text, marks: [{ type: 'textStyle', attrs: { fontFamily: 'Arimo' } }] }],
        })
        const header = (text: string) => [p(text)]
        const footer = [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Page ' },
              { type: 'storyField', attrs: { field: 'PAGE' } },
              { type: 'text', text: ' / ' },
              { type: 'storyField', attrs: { field: 'NUMPAGES' } },
            ],
          },
        ]
        setup.stories = {
          differentFirst: true,
          differentEven: true,
          start: 7,
          format: 'upperRoman',
          title: 'Synthetic PDF title',
          header: { default: header('ODD HEADER'), first: header('FIRST HEADER'), even: header('EVEN HEADER') },
          footer: { default: footer, first: footer, even: footer },
        }
        const content =
          kind === 'paragraph'
            ? [
                p(
                  'PROSE-BEGIN ' +
                    'Polish text zażółć gęślą jaźń, long paragraphs flow across pages. '.repeat(220) +
                    ' PROSE-END',
                ),
              ]
            : [
                {
                  type: 'table',
                  content: Array.from({ length: 65 }, (_, i) => ({
                    type: 'tableRow',
                    attrs: { repeatHeader: i === 0 },
                    content: [
                      { type: i ? 'tableCell' : 'tableHeader', content: [p(i ? `ROW-${i}` : 'REPEAT-HEADER')] },
                      {
                        type: i ? 'tableCell' : 'tableHeader',
                        content: [
                          p(i === 17 ? 'TALL-START ' + 'Tall cell content. '.repeat(180) + ' TALL-END' : `Cell ${i}`),
                        ],
                      },
                    ],
                  })),
                },
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'image',
                      attrs: {
                        src: `data:image/png;base64,${png}`,
                        width: 100,
                        height: 1200,
                        alt: 'Tall synthetic image',
                      },
                    },
                  ],
                },
              ]
        editor.commands.setContent({
          type: 'doc',
          attrs: { ...editor.getJSON().attrs, pageSetup: JSON.stringify(setup) },
          content: [
            { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Fixture heading' }] },
            ...content,
            p('DOCUMENT-END'),
          ],
        })
        editor.view.dispatch(editor.state.tr.setDocAttribute('pageSetup', JSON.stringify(setup)))
      },
      { width, height, kind, png: Buffer.from(generatedPNG(100, 1200)).toString('base64') },
    )
    await expect
      .poll(() =>
        page.evaluate(() =>
          Array.from(document.fonts).some(
            (font) => font.family.replace(/["']/g, '') === 'Arimo' && font.status === 'loaded',
          ),
        ),
      )
      .toBe(true)
    await page.evaluate(async () => {
      await document.fonts.ready
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      )
    })
    await expect.poll(() => page.locator('.draft-sheet').count()).toBeGreaterThan(2)
    const count = await page.locator('.draft-sheet').count()
    await page.getByRole('tab', { name: 'File', exact: true }).click()
    await page.getByRole('button', { name: 'Print preview', exact: true }).click()
    const preview = page.frameLocator('iframe[title="Print preview"]')
    await expect(preview.locator('.print-sheet')).toHaveCount(count)
    const event = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download PDF', exact: true }).click()
    const chunks: Buffer[] = []
    for await (const chunk of await (await event).createReadStream()) chunks.push(Buffer.from(chunk))
    const bytes = Buffer.concat(chunks),
      pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBe(count)
    expect(pdf.getTitle()).toBe('Synthetic PDF title')
    mkdirSync('docs/print-pdf-audit/fixtures', { recursive: true })
    writeFileSync(`docs/print-pdf-audit/fixtures/${name}.pdf`, bytes)
    const rendered = await inspectPDF(bytes, `docs/print-pdf-audit/fixtures/${name}`)
    const text = rendered.pages.map((page) => page.text).join('\n')
    expect(text).toContain('DOCUMENT-END')
    expect(rendered.pages[0].text).toContain('FIRST HEADER')
    expect(rendered.pages[1].text).toContain('EVEN HEADER')
    expect(rendered.pages[2].text).toContain('ODD HEADER')
    const headerGlyph = rendered.pages[0].glyphs.find((glyph) => glyph.text.includes('FIRST HEADER'))!
    expect(headerGlyph.transform[3]).toBeCloseTo(12, 0)
    expect(headerGlyph.transform[5]).toBeGreaterThan(pdf.getPage(0).getHeight() * 0.8)
    const footerGlyph = rendered.pages[0].glyphs.find((glyph) => glyph.text.startsWith('Page '))!
    expect(footerGlyph.transform[5]).toBeLessThan(pdf.getPage(0).getHeight() * 0.15)
    for (const page of rendered.pages) expect(page.text).toContain(` / ${count}`)
    if (kind === 'paragraph') {
      expect(text).toContain('PROSE-BEGIN')
      expect(text).toContain('PROSE-END')
    } else {
      for (let i = 1; i < 65; i++) expect(text.match(new RegExp(`ROW-${i}(?!\\d)`, 'g'))).toHaveLength(1)
      expect(text).toContain('TALL-END')
      expect(rendered.pages.filter((page) => page.text.includes('REPEAT-HEADER')).length).toBeGreaterThan(1)
    }
    const opening = context.waitForEvent('page')
    await page.getByRole('button', { name: 'Print', exact: true }).click()
    const print = await opening
    await expect(print.locator('html')).toHaveAttribute('data-print-requested', 'true')
    const rendering = await context.newPage()
    await rendering.setContent(await print.content())
    await rendering.evaluate(async () => {
      await Promise.all(Array.from(document.fonts, (font) => font.load()))
      await document.fonts.ready
    })
    const native = await rendering.pdf({ preferCSSPageSize: true })
    expect((await PDFDocument.load(native)).getPageCount()).toBe(count)
    writeFileSync(
      `docs/print-pdf-audit/fixtures/${name}.json`,
      JSON.stringify(
        {
          editorPages: count,
          previewPages: count,
          pdfPages: pdf.getPageCount(),
          nativePages: (await PDFDocument.load(native)).getPageCount(),
          width: pdf.getPage(0).getWidth(),
          height: pdf.getPage(0).getHeight(),
        },
        null,
        2,
      ) + '\n',
    )
    await rendering.close()
    await print.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  })

test('preview, native print and downloadable PDF share editor pages, text, links and outline', async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    window.print = () => {
      document.documentElement.dataset.printRequested = 'true'
    }
  })
  await page.goto('./#/draft')
  const body = page.locator('.draft-paper .tiptap')
  await body.waitFor()
  await body.evaluate((element) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor
    const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1, anchorId: 'first' },
          content: [{ type: 'text', text: 'Zażółć — first heading' }],
        },
        p('Selectable Polish text: ąćęłńóśźż.'),
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'External link', marks: [{ type: 'link', attrs: { href: 'https://example.test' } }] },
          ],
        },
        ...Array.from({ length: 2 }, (_, index) => [
          {
            type: 'heading',
            attrs: { level: 2, anchorId: `section_${index}`, pageBreakBefore: 1 },
            content: [{ type: 'text', text: `Section ${index + 2}` }],
          },
          p('Body text. '.repeat(30)),
        ]).flat(),
      ],
    })
  })
  await expect(page.locator('.draft-sheet')).toHaveCount(3)
  const before = await body.evaluate((element) =>
    JSON.stringify((element as HTMLElement & { editor: Editor }).editor.getJSON()),
  )
  await page.getByRole('tab', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: 'Print preview', exact: true }).click()
  const frame = page.frameLocator('iframe[title="Print preview"]')
  await expect(frame.locator('.print-sheet')).toHaveCount(3)
  await expect(frame.locator('svg').first()).toContainText('Selectable Polish text')
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click()
  const download = await downloading,
    chunks: Buffer[] = []
  for await (const chunk of await download.createReadStream()) chunks.push(Buffer.from(chunk))
  const bytes = Buffer.concat(chunks),
    pdf = await PDFDocument.load(bytes)
  expect(pdf.getPageCount()).toBe(3)
  expect(pdf.getTitle()).toBe('Untitled')
  const root = pdf.catalog.lookup(PDFName.of('Outlines'), PDFDict)
  const first = pdf.context.lookup(root.get(PDFName.of('First'))!, PDFDict)
  expect((first.get(PDFName.of('Title')) as PDFHexString).decodeText()).toBe('Zażółć — first heading')
  expect(first.has(PDFName.of('First'))).toBe(true)
  expect(pdf.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).size()).toBeGreaterThan(0)
  expect(bytes.toString('latin1')).toContain('/FontFile2')
  const popup = context.waitForEvent('page')
  await page.getByRole('button', { name: 'Print', exact: true }).click()
  const print = await popup
  await expect(print.locator('html')).toHaveAttribute('data-print-requested', 'true')
  await expect(print.locator('.print-sheet')).toHaveCount(3)
  const rendered = await context.newPage()
  await rendered.setContent(await print.content())
  await rendered.evaluate(async () => {
    await Promise.all(Array.from(document.fonts, (font) => font.load()))
    await document.fonts.ready
  })
  mkdirSync('docs/print-pdf-audit', { recursive: true })
  const native = await rendered.pdf({ path: 'docs/print-pdf-audit/native.pdf', preferCSSPageSize: true })
  expect((await PDFDocument.load(native)).getPageCount()).toBe(3)
  writeFileSync('docs/print-pdf-audit/export.pdf', bytes)
  const inspected = await inspectPDF(bytes, 'docs/print-pdf-audit/export')
  const nativeInspection = await inspectPDF(native, 'docs/print-pdf-audit/native')
  expect(inspected.pages[0].text).toContain('Selectable Polish text: ąćęłńóśźż.')
  expect(inspected.pages.map((page) => page.text.includes('Section 2'))).toEqual([false, true, false])
  expect(nativeInspection.pages.map((page) => page.text.includes('Section 2'))).toEqual([false, true, false])
  expect(inspected.pages[0].links.some((link) => link.url === 'https://example.test/')).toBe(true)
  expect(inspected.pages[0].png).toMatchSnapshot('print-pdf-shared-first.png', { maxDiffPixelRatio: 0.02 })
  expect(nativeInspection.pages[0].png).toMatchSnapshot('print-pdf-shared-first.png', { maxDiffPixelRatio: 0.02 })
  await print.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await rendered.close()
  await page.getByRole('button', { name: 'Back to editor', exact: true }).click()
  await expect(body).toBeEditable()
  expect(
    await body.evaluate((element) => JSON.stringify((element as HTMLElement & { editor: Editor }).editor.getJSON())),
  ).toBe(before)
})
