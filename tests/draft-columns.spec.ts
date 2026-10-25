import { expect, test } from '@playwright/test'
import type { Editor } from '@tiptap/core'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { draftFileAction } from './helpers/reveal-toolbar-command'
import { strFromU8, unzipSync } from 'fflate'

for (const columns of [1, 2, 3]) {
  test(`PP08 ${columns} columns preserve multipage text in preview/PDF`, async ({ page, context }) => {
    test.setTimeout(120000)
    await page.setViewportSize({ width: 1440, height: 1500 })
    await page.goto('./#/draft')
    const editor = page.locator('.tiptap')
    await expect(editor).toBeVisible()
    await editor.evaluate((element) => {
      const editor = (element as HTMLElement & { editor: Editor }).editor
      const content = [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Column field report' }] },
        ...Array.from({ length: 25 }, (_, i) => ({
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text:
                `Record${String(i).padStart(3, '0')} ` +
                'A realistic paragraph with Polish zażółć and enough words to cross lines and column boundaries. '.repeat(
                  i === 8 ? 70 : 4,
                ),
            },
          ],
        })),
        {
          type: 'orderedList',
          attrs: { start: 3 },
          content: [0, 1, 2].map((i) => ({
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: `List item ${i + 1}` }] }],
          })),
        },
        { type: 'paragraph', content: [{ type: 'pageBreak' }, { type: 'text', text: 'Explicit final page.' }] },
      ]
      editor.commands.setContent({ type: 'doc', content })
      editor.view.dispatch(
        editor.state.tr.setDocAttribute(
          'pageSetup',
          JSON.stringify({
            width: 11906,
            height: 16838,
            orientation: 'portrait',
            top: 1134,
            right: 1134,
            bottom: 1134,
            left: 1134,
            header: 567,
            footer: 567,
            headerText: 'PP08 field report',
            footerText: 'Local document',
            pageNumbers: true,
          }),
        ),
      )
    })
    await page.getByRole('tab', { name: 'Layout', exact: true }).click()
    await page.getByRole('combobox', { name: 'Columns', exact: true }).selectOption(String(columns))
    await page.evaluate(() => document.fonts.ready)
    await expect.poll(() => page.locator('.draft-sheet').count()).toBeGreaterThan(1)
    await page.waitForTimeout(600)
    if (columns > 1) {
      expect(await page.locator('.draft-document-area').evaluate((area) => area.scrollHeight)).toBeLessThan(
        (await page.locator('.draft-paper').evaluate((paper) => paper.getBoundingClientRect().height)) + 120,
      )
    }
    const before = await editor.evaluate((el) =>
      JSON.stringify((el as HTMLElement & { editor: Editor }).editor.getJSON()),
    )
    await mkdir('docs/verification/assets/pp08', { recursive: true })
    await page.screenshot({ path: `docs/verification/assets/pp08/editor-${columns}.png` })
    await page
      .locator('.draft-sheet')
      .first()
      .screenshot({ path: `docs/verification/assets/pp08/editor-sheet-${columns}.png` })
    await draftFileAction(page, 'Print preview')
    const preview = page.frameLocator('iframe[title="Print preview"]')
    await expect(preview.locator('.print-sheet').first()).toBeVisible({ timeout: 30000 })
    const count = await preview.locator('.print-sheet').count()
    await page.screenshot({ path: `docs/verification/assets/pp08/preview-${columns}.png` })
    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download PDF', exact: true }).click()
    const download = await downloading
    const chunks: Buffer[] = []
    for await (const chunk of await download.createReadStream()) chunks.push(Buffer.from(chunk))
    const bytes = Buffer.concat(chunks)
    await writeFile(`docs/verification/assets/pp08/columns-${columns}.pdf`, bytes)
    const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise
    const rendering = await context.newPage()
    await rendering.route('**/pp08-pdf.mjs', (route) =>
      route.fulfill({ contentType: 'text/javascript', path: 'node_modules/pdfjs-dist/build/pdf.mjs' }),
    )
    await rendering.route('**/pp08-worker.mjs', (route) =>
      route.fulfill({ contentType: 'text/javascript', path: 'node_modules/pdfjs-dist/build/pdf.worker.mjs' }),
    )
    await rendering.goto('./')
    await rendering.setContent('<style>body{margin:0;background:white}canvas{display:block}</style><canvas></canvas>')
    await rendering.evaluate(async (bytes) => {
      const moduleURL = location.origin + '/AllSuite/pp08-pdf.mjs'
      const pdfjs = await import(moduleURL)
      pdfjs.GlobalWorkerOptions.workerSrc = location.origin + '/AllSuite/pp08-worker.mjs'
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise
      Object.assign(window, {
        renderColumnPage: async (index: number) => {
          const page = await pdf.getPage(index)
          const viewport = page.getViewport({ scale: 4 / 3 })
          const canvas = document.querySelector('canvas')!
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise
        },
      })
    }, Array.from(bytes))
    expect(pdf.numPages).toBe(count)
    let text = ''
    let bodyText = ''
    for (let i = 1; i <= pdf.numPages; i++) {
      const sheet = await pdf.getPage(i)
      const items = (await sheet.getTextContent()).items.filter((item) => 'str' in item)
      text += items.map((item) => item.str).join('')
      bodyText += items
        .filter(
          (item) =>
            item.transform[5] < sheet.view[3] - 1134 / 20 &&
            item.transform[5] > 1134 / 20 &&
            !['3.', '4.', '5.'].includes(item.str),
        )
        .map((item) => item.str)
        .join('')
      expect(sheet.view[2]).toBeCloseTo(11906 / 20, 1)
      await rendering.evaluate(
        (index) =>
          (window as unknown as { renderColumnPage: (index: number) => Promise<void> }).renderColumnPage(index),
        i,
      )
      await rendering.locator('canvas').screenshot({ path: `docs/verification/assets/pp08/pdf-${columns}-${i}.png` })
    }
    let previous = -1
    for (let i = 0; i < 25; i++) {
      const marker = `Record${String(i).padStart(3, '0')}`
      const index = text.indexOf(marker)
      expect(index, marker).toBeGreaterThan(previous)
      expect(text.split(marker)).toHaveLength(2)
      previous = index
    }
    expect(text).toContain('List item 3')
    expect(
      bodyText
        .replace(/\s/g, '')
        .split('ArealisticparagraphwithPolishzażółćandenoughwordstocrosslinesandcolumnboundaries.'),
    ).toHaveLength(167)
    expect(text).toContain('Explicit final page.')
    expect(text).toContain('PP08 field report')
    const lastPage = await pdf.getPage(pdf.numPages)
    const finalItem = (await lastPage.getTextContent()).items.find(
      (item) => 'str' in item && item.str.includes('Explicit final page.'),
    )
    expect(finalItem && 'transform' in finalItem ? finalItem.transform[4] : -1).toBeCloseTo(1134 / 20 + 0.75, 0)
    await page.getByRole('button', { name: 'Back to editor', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(editor).toBeFocused()
    expect(
      await editor.evaluate((el) => JSON.stringify((el as HTMLElement & { editor: Editor }).editor.getJSON())),
    ).toBe(before)
    await pdf.cleanup()
    const editorImage = (await readFile(`docs/verification/assets/pp08/editor-sheet-${columns}.png`)).toString('base64')
    const pdfImage = (await readFile(`docs/verification/assets/pp08/pdf-${columns}-1.png`)).toString('base64')
    await rendering.setViewportSize({ width: 1660, height: 1240 })
    await rendering.setContent(
      `<style>body{margin:16px;background:#eee;font:16px sans-serif}main{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0}figcaption{padding:8px}img{width:100%;display:block}</style><main><figure><figcaption>Draft editor — ${columns} column(s)</figcaption><img src="data:image/png;base64,${editorImage}"></figure><figure><figcaption>Exported PDF — page 1</figcaption><img src="data:image/png;base64,${pdfImage}"></figure></main>`,
    )
    await rendering.evaluate(() => Promise.all(Array.from(document.images, (image) => image.decode())))
    await rendering.screenshot({ path: `docs/verification/assets/pp08/comparison-${columns}.png`, fullPage: true })
    await rendering.close()
  })
}

test('PP08 refuses unsupported objects and margin comments without a download or source mutation', async ({ page }) => {
  await page.goto('./#/draft')
  const editor = page.locator('.tiptap')
  await expect(editor).toBeVisible()
  await editor.evaluate((element) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor
    editor.commands.setContent('<p>Protected text</p><table><tr><td><p>Unsupported table</p></td></tr></table>')
  })
  await page.getByRole('tab', { name: 'Layout', exact: true }).click()
  await page.getByRole('combobox', { name: 'Columns', exact: true }).selectOption('2')
  const before = await editor.evaluate((el) =>
    JSON.stringify((el as HTMLElement & { editor: Editor }).editor.getJSON()),
  )
  const downloads: string[] = []
  page.on('download', (download) => downloads.push(download.suggestedFilename()))
  await draftFileAction(page, 'PDF')
  await expect(
    page.getByText(
      'Column preview/PDF supports text, headings and lists. Remove body objects and margin comments, or switch to one column.',
      { exact: true },
    ),
  ).toBeVisible()
  expect(downloads).toEqual([])
  expect(await editor.evaluate((el) => JSON.stringify((el as HTMLElement & { editor: Editor }).editor.getJSON()))).toBe(
    before,
  )
  await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toBeVisible()
  await editor.evaluate((element) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor
    editor.commands.setContent('<p>Commented text</p>')
    editor.view.dispatch(
      editor.state.tr.setDocAttribute(
        'comments',
        JSON.stringify([{ id: 'margin', author: 'Reviewer', text: 'Margin comment', resolved: false, replies: [] }]),
      ),
    )
  })
  await draftFileAction(page, 'Print preview')
  await expect(
    page.getByText(
      'Column preview/PDF supports text, headings and lists. Remove body objects and margin comments, or switch to one column.',
      { exact: true },
    ),
  ).toBeVisible()
  expect(downloads).toEqual([])
})

test('PP08 PDF exports the captured column snapshot while later edits stay dirty', async ({ page }) => {
  await page.addInitScript(() => {
    const fetch = window.fetch.bind(window)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    Object.assign(window, { releaseColumnExport: release })
    window.fetch = async (...args) => {
      if (String(args[0]).endsWith('.woff')) await gate
      return fetch(...args)
    }
  })
  await page.goto('./#/draft')
  const editor = page.locator('.tiptap')
  await editor.fill('Original two column snapshot')
  await page.getByRole('tab', { name: 'Layout', exact: true }).click()
  await page.getByRole('combobox', { name: 'Columns', exact: true }).selectOption('2')
  const downloading = page.waitForEvent('download')
  await draftFileAction(page, 'PDF')
  await expect(page.getByText('Preparing export…', { exact: true })).toBeVisible()
  await editor.fill('Later unsaved text')
  await page.evaluate(() => (window as unknown as { releaseColumnExport: () => void }).releaseColumnExport())
  const chunks: Buffer[] = []
  for await (const chunk of await (await downloading).createReadStream()) chunks.push(Buffer.from(chunk))
  const pdf = await getDocument({ data: new Uint8Array(Buffer.concat(chunks)) }).promise
  const text = (await (await pdf.getPage(1)).getTextContent()).items
    .map((item) => ('str' in item ? item.str : ''))
    .join(' ')
  expect(text).toContain('Original two column snapshot')
  expect(text).not.toContain('Later unsaved text')
  await expect(editor).toHaveText('Later unsaved text')
  await expect(page.getByRole('status')).toContainText('Unsaved changes')
  await pdf.cleanup()
})

test('PP08 authored DOCX saves and reopens with columns, content and page settings', async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true })
  })
  await page.goto('./#/draft')
  const editor = page.locator('.tiptap')
  await editor.fill('Column document saved and reopened.')
  await page.getByRole('tab', { name: 'Layout', exact: true }).click()
  await page.getByRole('combobox', { name: 'Columns', exact: true }).selectOption('3')
  const downloading = page.waitForEvent('download')
  await draftFileAction(page, 'Save document')
  const chunks: Buffer[] = []
  for await (const chunk of await (await downloading).createReadStream()) chunks.push(Buffer.from(chunk))
  const bytes = Buffer.concat(chunks)
  const xml = strFromU8(unzipSync(bytes)['word/document.xml'])
  expect(xml).toMatch(/<w:cols[^>]*w:num="3"/)
  expect(xml).toContain('w:space="480"')
  await expect(page.getByRole('status')).toContainText('Ready')
  const reopened = await context.newPage()
  await reopened.goto('./#/draft')
  const choosing = reopened.waitForEvent('filechooser')
  await draftFileAction(reopened, 'Open')
  await (
    await choosing
  ).setFiles({
    name: 'columns.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: bytes,
  })
  await expect(reopened.locator('.tiptap')).toContainText('Column document saved and reopened.')
  await reopened.getByRole('tab', { name: 'Layout', exact: true }).click()
  await expect(reopened.getByRole('combobox', { name: 'Columns', exact: true })).toHaveValue('3')
  await expect(reopened.locator('.draft-paper')).toHaveClass(/draft-paper--columns/)
  await reopened.close()
})

for (const geometry of [
  {
    name: 'Letter landscape',
    width: 15840,
    height: 12240,
    orientation: 'landscape',
    top: 1440,
    bottom: 900,
    left: 1000,
    right: 1200,
    columns: 2,
  },
  {
    name: 'A5 narrow margins',
    width: 8391,
    height: 11906,
    orientation: 'portrait',
    top: 720,
    bottom: 720,
    left: 600,
    right: 600,
    columns: 3,
  },
])
  test(`PP08 short text on ${geometry.name}`, async ({ page, context }) => {
    test.setTimeout(60000)
    await context.addInitScript(() => {
      window.print = () => {
        document.documentElement.dataset.printRequested = 'true'
      }
    })
    await page.goto('./#/draft')
    const editor = page.locator('.tiptap')
    await expect(editor).toBeVisible()
    await editor.evaluate((element, geometry) => {
      const editor = (element as HTMLElement & { editor: Editor }).editor
      editor.commands.setContent(
        '<h2>Short column report</h2><p>Complete short content.</p><ul><li><p>A bullet entry.</p></li></ul>',
      )
      editor.view.dispatch(
        editor.state.tr.setDocAttribute(
          'pageSetup',
          JSON.stringify({
            ...geometry,
            header: 300,
            footer: 300,
            headerText: 'Short report header',
            footerText: 'Footer',
            pageNumbers: true,
          }),
        ),
      )
    }, geometry)
    await page.getByRole('tab', { name: 'Layout', exact: true }).click()
    await page.getByRole('combobox', { name: 'Columns', exact: true }).selectOption(String(geometry.columns))
    await draftFileAction(page, 'Print preview')
    const preview = page.frameLocator('iframe[title="Print preview"]')
    await expect(preview.locator('.print-sheet')).toHaveCount(1)
    const svg = await preview.locator('svg').evaluate((el) => el.outerHTML)
    expect(svg).toContain(`width="${geometry.width / 15}"`)
    const opening = page.waitForEvent('popup')
    await page.getByRole('button', { name: 'Print', exact: true }).click()
    const popup = await opening
    await expect(popup.locator('html')).toHaveAttribute('data-print-requested', 'true')
    expect(await popup.locator('svg').evaluate((el) => el.outerHTML)).toBe(svg)
    const printing = await context.newPage()
    await printing.setContent(await popup.content())
    await printing.evaluate(async () => {
      await Promise.all(Array.from(document.fonts, (face) => face.load()))
      await document.fonts.ready
    })
    const nativePDF = await getDocument({ data: new Uint8Array(await printing.pdf({ preferCSSPageSize: true })) })
      .promise
    expect(nativePDF.numPages).toBe(1)
    const nativePage = await nativePDF.getPage(1)
    expect(nativePage.view[2]).toBeCloseTo(geometry.width / 20, 0)
    expect(nativePage.view[3]).toBeCloseTo(geometry.height / 20, 0)
    expect(
      (await nativePage.getTextContent()).items.map((item) => ('str' in item ? item.str : '')).join(' '),
    ).toContain('Complete short content.')
    await nativePDF.cleanup()
    await printing.close()
    await popup.close()
  })
