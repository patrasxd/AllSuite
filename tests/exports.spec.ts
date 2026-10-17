import { expect, test, type Page } from '@playwright/test'
import { inflateSync } from 'node:zlib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { generatedPNG } from './fixtures/png'
import type { Editor } from '@tiptap/core'

async function sample(page: Page, long = false) {
  await page.goto('./#/draft')
  const editor = page.locator('.tiptap')
  const image = Buffer.from(generatedPNG(240, 120)).toString('base64')
  const html = `<h1>Zażółć gęślą jaźń</h1><p>ĄĆĘŁŃÓŚŹŻ ąćęłńóśźż. <strong>Bold</strong> and <em>italic</em>.</p><p><span style="font-family:Cambria">A local serif font: zażółć.</span></p><p><span style="font-family:Courier New">Local mono: ąćęłńóśźż.</span></p><ol start="3"><li><p>First list item</p><ul><li><p>Nested bullet</p></li></ul></li><li><p>Second list item</p></li></ol><p><img src="data:image/png;base64,${image}" width="240" height="120" alt="Synthetic blue image"></p><table><thead><tr><th><p>Label</p></th><th><p>Value</p></th></tr></thead><tbody>${Array.from({ length: long ? 60 : 2 }, (_, i) => `<tr><td><p>Row ${i + 1}</p></td><td><p>Polish: zażółć ${i + 1}</p></td></tr>`).join('')}</tbody></table><p>Final export paragraph.</p>`
  await editor.focus()
  await editor.evaluate((element, html) => {
    const data = new DataTransfer()
    data.setData('text/html', html)
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
  }, html)
  await expect(editor.locator('img[src]')).toHaveCount(1)
  await expect(editor.locator('h1')).toHaveText('Zażółć gęślą jaźń')
  await page.getByRole('tab', { name: 'File', exact: true }).click()
  return editor
}
async function choose(page: Page, name: string) {
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await page.getByRole('menuitem', { name, exact: true }).click()
}
async function downloadFormat(page: Page, name: string) {
  const downloading = page.waitForEvent('download')
  await choose(page, name)
  const download = await downloading
  const chunks: Buffer[] = []
  for await (const chunk of await download.createReadStream()) chunks.push(Buffer.from(chunk))
  return { bytes: Buffer.concat(chunks), name: download.suggestedFilename() }
}

test('downloads Markdown, standalone HTML and text locally without changing the document or dirty state', async ({
  page,
  context,
}) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  const editor = await sample(page)
  const model = () =>
    editor.evaluate((element) => JSON.stringify((element as HTMLElement & { editor: Editor }).editor.getJSON()))
  const before = await model()
  const markdown = await downloadFormat(page, 'Markdown')
  expect(markdown.name).toBe('Untitled.md')
  expect(markdown.bytes.toString()).toContain('# Zażółć gęślą jaźń')
  expect(markdown.bytes.toString()).toContain('| Label | Value |')
  expect(markdown.bytes.toString()).toContain('3. First list item')
  const text = await downloadFormat(page, 'Plain text')
  expect(text.name).toBe('Untitled.txt')
  expect(text.bytes.toString()).toContain('Label\tValue')
  const html = await downloadFormat(page, 'HTML')
  expect(html.name).toBe('Untitled.html')
  expect(html.bytes.toString()).toContain('data:font/woff2;base64,')
  expect(html.bytes.toString()).not.toContain('<script')
  const rendered = await context.newPage()
  await rendered.setContent(html.bytes.toString())
  await rendered.evaluate(async () => {
    await Promise.all(Array.from(document.fonts, (face) => face.load()))
    await document.fonts.ready
  })
  await expect(rendered.getByRole('heading', { name: 'Zażółć gęślą jaźń' })).toBeVisible()
  await expect(rendered.getByRole('img', { name: 'Synthetic blue image' })).toBeVisible()
  expect(await rendered.getByRole('img').getAttribute('src')).toMatch(/^data:image\/png;base64,/)
  await rendered.close()
  expect(await model()).toBe(before)
  await expect(page.getByRole('status')).toContainText('Unsaved changes')
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toMatch(/Zażółć|Final export|data:image/)
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([])
  expect(requests.every((url) => new URL(url).origin === 'http://127.0.0.1:4176')).toBe(true)
})

test('PDF print document embeds open fonts, images and A4 pages; never reports the source saved', async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    window.print = () => {
      document.documentElement.dataset.printRequested = 'true'
    }
  })
  await sample(page, true)
  const opening = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Print', exact: true }).click()
  const print = await opening
  await expect(print.locator('html')).toHaveAttribute('data-print-requested', 'true', { timeout: 15000 })
  expect(await print.evaluate(() => window.opener)).toBeNull()
  expect(await print.locator('script').count()).toBe(0)
  expect(await print.evaluate(() => Array.from(document.fonts).every((face) => face.status === 'loaded'))).toBe(true)
  await expect(print.locator('.print-sheet')).toHaveCount(await page.locator('.draft-sheet').count())
  // Native afterprint closes the real popup. Render its exact standalone document in a
  // second page so CDP can return PDF bytes before that lifecycle cleanup is exercised.
  const rendering = await context.newPage()
  await rendering.setContent(await print.content())
  await rendering.evaluate(async () => {
    await Promise.all(Array.from(document.fonts, (face) => face.load()))
    await document.fonts.ready
    await Promise.all(Array.from(document.images, (image) => image.decode()))
  })
  const pdf = await rendering.pdf({
    path: 'test-results/draft-export.pdf',
    preferCSSPageSize: true,
    printBackground: true,
    displayHeaderFooter: false,
  })
  const raw = pdf.toString('latin1')
  expect(raw).toContain('/FontFile2')
  for (const family of ['Arimo', 'Caladea', 'Cousine'])
    expect(raw).toMatch(new RegExp(`/BaseFont /[A-Z]+\\+${family}-`))
  expect(raw).not.toMatch(/\/BaseFont \/(?:Helvetica|Times-Roman|Courier)\b/)
  expect(raw).toContain('/Subtype /Image')
  expect((raw.match(/\/Type \/Page\b/g) || []).length).toBeGreaterThanOrEqual(3)
  const media = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/.exec(raw)!
  expect(Number(media[1])).toBeCloseTo(595, 0)
  expect(Number(media[2])).toBeCloseTo(842, 0)
  const streams: string[] = []
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      streams.push(inflateSync(Buffer.from(match[1], 'latin1')).toString())
    } catch {
      /* JPEG and uncompressed streams are not CMaps. */
    }
  }
  const maps = streams.filter((stream) => stream.includes('begincmap')).join('\n')
  for (const code of ['0105', '0107', '0119', '0142', '0144', '00f3', '015b', '017a', '017c'])
    expect(maps.toLowerCase()).toContain(`<${code}>`)
  await rendering.screenshot({ path: 'test-results/export-print-document.png', fullPage: true })
  await rendering.close()
  await print.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await expect.poll(() => print.isClosed()).toBe(true)
  await expect(page.getByRole('status')).toContainText('Unsaved changes')
})

test('adds an anchored comment and renders it in the print margin while PDF inclusion stays off by default', async ({
  page,
}) => {
  await page.goto('./#/draft')
  const editor = page.locator('.tiptap')
  await editor.evaluate((element) => {
    const instance = (element as HTMLElement & { editor: Editor }).editor
    instance.commands.setContent('<p>Commented words stay in the document.</p>')
    instance.commands.setTextSelection({ from: 1, to: 16 })
  })
  await page.getByRole('tab', { name: 'Review', exact: true }).click()
  await editor.focus()
  await editor.press('Control+Alt+m')
  await expect(page.locator('.draft-comments-panel')).toBeVisible()
  await editor.press('Control+Alt+Shift+m')
  await expect(page.locator('.draft-comments-panel')).toHaveCount(0)
  await editor.press('Control+Alt+Shift+m')
  await expect(page.locator('.draft-comments-panel')).toBeVisible()
  await page.getByLabel('Your name for this session').fill('Avery')
  await page.getByLabel('New comment').fill('Please clarify this section.')
  await page.locator('.draft-comment-compose').getByRole('button', { name: 'Add comment' }).click()
  await expect(editor.locator('[data-comment-id]')).toHaveText('Commented words')
  await expect(page.locator('.draft-comment-pin')).toBeVisible()
  await page.getByRole('tab', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: 'Print preview', exact: true }).click()
  const print = page.frameLocator('iframe[title="Print preview"]')
  await expect(print.locator('.print-sheet')).toContainText('Avery')
  await expect(print.locator('.print-sheet')).toContainText('Please')
  await expect(print.locator('.print-sheet')).toContainText('section.')
  const includeComments = page.locator('.draft-pdf-comments-toggle input')
  await expect(includeComments).not.toBeChecked()
  const readPDFText = async () => {
    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download PDF', exact: true }).click()
    const chunks: Buffer[] = []
    for await (const chunk of await (await downloading).createReadStream()) chunks.push(Buffer.from(chunk))
    const loading = getDocument({ data: new Uint8Array(Buffer.concat(chunks)), disableFontFace: true })
    const pdf = await loading.promise
    try {
      const pages = await Promise.all(
        Array.from({ length: pdf.numPages }, async (_, index) => {
          const page = await pdf.getPage(index + 1)
          return (await page.getTextContent()).items.map((item) => ('str' in item ? item.str : '')).join(' ')
        }),
      )
      return pages.join('\n')
    } finally {
      await loading.destroy()
    }
  }
  expect(await readPDFText()).not.toContain('Please clarify this section.')
  await includeComments.check()
  const includedPDF = await readPDFText()
  expect(includedPDF).toContain('Please')
  expect(includedPDF).toContain('section.')
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toMatch(/Avery|Please clarify this section/)
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([])
})

test('exports a captured snapshot while later edits stay dirty, and handles font/popup failures', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    Object.assign(window, { releaseExport: release })
    window.fetch = async (...args) => {
      if (String(args[0]).endsWith('.woff2')) await gate
      return original(...args)
    }
  })
  await page.goto('./#/draft')
  const editor = page.locator('.tiptap')
  await editor.fill('Original export snapshot')
  await page.getByRole('tab', { name: 'File', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await choose(page, 'HTML')
  await expect(page.getByText('Preparing export…', { exact: true })).toBeVisible()
  await editor.fill('Newer unsaved edit')
  await page.evaluate(() => (window as unknown as { releaseExport: () => void }).releaseExport())
  const bytes: Buffer[] = []
  for await (const chunk of await (await downloading).createReadStream()) bytes.push(Buffer.from(chunk))
  expect(Buffer.concat(bytes).toString()).toContain('Original export snapshot')
  expect(Buffer.concat(bytes).toString()).not.toContain('Newer unsaved edit')
  await expect(page.getByRole('status')).toContainText('Unsaved changes')
  await page.evaluate(() => {
    window.fetch = () => Promise.reject(new Error('Unavailable font'))
    window.open = () => null
  })
  await choose(page, 'HTML')
  await expect(page.getByText('The document could not be exported. Please try again.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Print', exact: true }).click()
  await expect(page.getByText('Allow a print window to open, then choose Print again.', { exact: true })).toBeVisible()
  await expect(editor).toHaveText('Newer unsaved edit')
})

test('@smoke exports HTML offline using only precached static code/fonts and keeps a saved source clean', async ({
  page,
  context,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }),
  )
  await page.goto('./#/draft')
  await page.locator('.tiptap').fill('Offline Zażółć gęślą jaźń')
  await page.getByRole('tab', { name: 'File', exact: true }).click()
  const saving = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await saving
  await expect(page.getByRole('status')).toContainText('Ready')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  await context.setOffline(true)
  const html = await downloadFormat(page, 'HTML')
  expect(html.bytes.toString()).toContain('Offline Zażółć gęślą jaźń')
  await expect(page.getByRole('status')).toContainText('Ready')
})

for (const theme of ['dark', 'light', 'e-ink-light', 'e-ink-dark'])
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 820, height: 1180 },
    { width: 1280, height: 800 },
    { width: 1920, height: 1080 },
  ]) {
    test(`@slow export menu ${theme} ${viewport.width}`, async ({ page }) => {
      const locale = viewport.width === 390 ? 'pl' : 'en'
      await page.setViewportSize(viewport)
      await page.addInitScript(
        ({ locale, theme }) => {
          localStorage.setItem('allsuite:locale', locale)
          localStorage.setItem('allsuite:theme', theme)
        },
        { locale, theme },
      )
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto('./#/draft')
      await page.locator('.tiptap').fill('Zażółć gęślą jaźń')
      await page.getByRole('tab', { name: locale === 'pl' ? 'Plik' : 'File', exact: true }).click()
      const trigger = page.getByRole('button', { name: locale === 'pl' ? 'Eksportuj' : 'Export', exact: true })
      await trigger.focus()
      await trigger.press('ArrowDown')
      const menu = page.getByRole('menu')
      await expect(menu.getByRole('menuitem').first()).toBeFocused()
      await menu.getByRole('menuitem').first().press('End')
      await expect(menu.getByRole('menuitem').last()).toBeFocused()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width)
      expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(0)
      const rect = (await menu.boundingBox())!
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width)
      expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height)
      for (const item of await menu.getByRole('menuitem').all()) {
        const box = (await item.boundingBox())!
        expect(box.height).toBeGreaterThanOrEqual(44)
        expect(box.width).toBeGreaterThanOrEqual(44)
      }
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({ path: `test-results/export-menu-${theme}-${viewport.width}.png` })
      await page.keyboard.press('Escape')
      await expect(trigger).toBeFocused()
      await expect(menu).toHaveCount(0)
      expect((await page.locator('.draft-document-area').boundingBox())!.height).toBeGreaterThan(80)
    })
  }
