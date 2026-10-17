import { expect, test, type Page, type Locator } from '@playwright/test'
import type { Editor, JSONContent } from '@tiptap/core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { generatedPNG } from './fixtures/png'
import { inspectPDF } from './fixtures/render-pdf'

const p = (text: string): JSONContent => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })
async function controls(container: Locator, touch: boolean) {
  for (const control of await container.locator('button,input:not([type=file]),select').all()) {
    if (!(await control.isVisible())) continue
    await expect(control).toHaveAccessibleName(/\S/)
    if (touch) {
      const box = (await control.boundingBox())!
      expect(box.width).toBeGreaterThanOrEqual(44)
      expect(box.height).toBeGreaterThanOrEqual(44)
    }
    if (!(await control.isDisabled())) {
      await control.focus()
      await expect(control).toBeFocused()
      expect(
        await control.evaluate((element) => {
          const style = getComputedStyle(element)
          return parseFloat(style.outlineWidth) > 0 || style.boxShadow !== 'none'
        }),
      ).toBe(true)
    }
  }
}

for (const theme of ['dark', 'light', 'e-ink-light', 'e-ink-dark'])
  for (const locale of ['en', 'pl'])
    test(`MVP 3 page setup, stories and preview keyboard accessibility ${theme} ${locale}`, async ({ page }) => {
      const touch = locale === 'pl'
      await page.setViewportSize(touch ? { width: 390, height: 844 } : { width: 1280, height: 800 })
      await page.addInitScript(
        ({ theme, locale }) => {
          localStorage.setItem('allsuite:theme', theme)
          localStorage.setItem('allsuite:locale', locale)
        },
        { theme, locale },
      )
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto('./#/draft')
      const body = page.locator('.draft-paper .tiptap')
      await body.fill('Synthetic accessibility fixture')
      await page.getByRole('tab', { name: /^(Layout|Układ)$/ }).click()
      await controls(page.getByRole('toolbar', { name: /^(Layout|Układ)$/ }), touch)
      await page.getByRole('button', { name: /^(Page setup|Ustawienia strony)$/ }).click()
      const dialog = page.getByRole('dialog')
      await controls(dialog, touch)
      await page.getByRole('button', { name: /^(Edit rich headers and footers|Edytuj nagłówki i stopki)$/ }).click()
      await controls(dialog, touch)
      await expect(dialog.locator('.draft-story-input')).toHaveAccessibleName(/\S/)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await page.getByRole('tab', { name: /^(File|Plik)$/ }).click()
      const trigger = page.getByRole('button', { name: /^(Print preview|Podgląd wydruku)$/ })
      await trigger.focus()
      await page.keyboard.press('Enter')
      const back = page.getByRole('button', { name: /^(Back to editor|Wróć do edytora)$/ })
      await expect(back).toBeVisible()
      await expect(back).toBeFocused()
      await controls(page.getByRole('toolbar', { name: /^(Print preview|Podgląd wydruku)$/ }), touch)
      await expect(page.locator('iframe')).toHaveAccessibleName(/\S/)
      await back.focus()
      await page.keyboard.press('Enter')
      await expect(body).toBeFocused()
      await expect(body).toContainText('Synthetic accessibility fixture')
    })
async function pdfDownload(page: Page) {
  await page.getByRole('tab', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const downloading = page.waitForEvent('download', { timeout: 90000 })
  await page.getByRole('menuitem', { name: 'PDF', exact: true }).click()
  const chunks: Buffer[] = []
  for await (const chunk of await (await downloading).createReadStream()) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

test('MVP 3 direct PDF works offline with precached WOFF assets', async ({ page, context }) => {
  await page.goto('./#/draft')
  const body = page.locator('.draft-paper .tiptap')
  await body.fill('Offline PDF — zażółć gęślą jaźń')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }),
      )
  })
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const keys = (
          await Promise.all(
            (await caches.keys()).map(async (key) =>
              (await (await caches.open(key)).keys()).map((request) => request.url),
            ),
          )
        ).flat()
        return keys.filter((url) => /\.woff(?:\?|$)/.test(url)).length
      }),
    )
    .toBeGreaterThan(0)
  await context.setOffline(true)
  const bytes = await pdfDownload(page)
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
  expect((await inspectPDF(bytes)).pages[0].text).toContain('Offline PDF — zażółć gęślą jaźń')
  await expect(body).toContainText('Offline PDF')
})

for (const kind of ['empty', 'huge-table', 'huge-image', 'long-paragraph', 'mixed-languages'])
  test(`MVP 3 edge case ${kind} preserves content and physical pages`, async ({ page }) => {
    test.setTimeout(120000)
    await page.goto('./#/draft')
    const body = page.locator('.draft-paper .tiptap')
    await body.waitFor()
    const png = kind === 'huge-image' ? Buffer.from(generatedPNG(1200, 3600)).toString('base64') : ''
    const labels =
      kind === 'huge-table'
        ? Array.from({ length: 500 }, (_, i) => `ROW-${String(i).padStart(4, '0')}`)
        : kind === 'long-paragraph'
          ? Array.from({ length: 8000 }, (_, i) => `WORD-${String(i).padStart(4, '0')}`)
          : kind === 'mixed-languages'
            ? ['Zażółć gęślą jaźń', 'English selectable text', 'Français déjà Noël', 'Deutsch Straße für Größe']
            : []
    const content: JSONContent[] =
      kind === 'empty'
        ? [p('')]
        : kind === 'huge-table'
          ? [
              {
                type: 'table',
                content: [
                  {
                    type: 'tableRow',
                    attrs: { repeatHeader: true },
                    content: [{ type: 'tableHeader', content: [p('REPEAT-HEADER')] }],
                  },
                  ...labels.map((text) => ({ type: 'tableRow', content: [{ type: 'tableCell', content: [p(text)] }] })),
                ],
              },
            ]
          : kind === 'huge-image'
            ? [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'image',
                      attrs: {
                        src: `data:image/png;base64,${png}`,
                        width: 4000,
                        height: 12000,
                        alt: 'Huge synthetic image',
                      },
                    },
                  ],
                },
              ]
            : kind === 'long-paragraph'
              ? [p(labels.join(' '))]
              : labels.map(p)
    await body.evaluate((element, content) => {
      const editor = (element as HTMLElement & { editor: Editor }).editor
      editor.commands.setContent({ type: 'doc', content })
    }, content)
    if (kind === 'huge-image')
      await body
        .getByRole('img', { name: 'Huge synthetic image', exact: true })
        .evaluate((image: HTMLImageElement) => image.decode())
    await page.evaluate(() => document.fonts.ready)
    await expect.poll(() => page.locator('.draft-sheet').count()).toBeGreaterThan(0)
    // Let page-flow measurements settle, rather than sampling the previous count.
    await body.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        ),
    )
    const editorPages = await page.locator('.draft-sheet').count()
    const before = await body.evaluate((e) => JSON.stringify((e as HTMLElement & { editor: Editor }).editor.getJSON()))
    const bytes = await pdfDownload(page)
    const pdfPages = (await PDFDocument.load(bytes)).getPageCount()
    expect(pdfPages).toBe(editorPages)
    const inspected = await inspectPDF(bytes)
    const text = inspected.pages.map((page) => page.text).join(' ')
    for (const label of labels) expect(text.split(label)).toHaveLength(2)
    if (kind === 'huge-table') expect(inspected.pages.every((p) => p.text.includes('REPEAT-HEADER'))).toBe(true)
    if (kind === 'empty' || kind === 'huge-image') expect(pdfPages).toBe(1)
    if (kind === 'long-paragraph') expect(pdfPages).toBeGreaterThan(10)
    if (kind === 'huge-image') {
      const box = await body.locator('.draft-image').boundingBox()
      expect(box!.height / box!.width).toBeCloseTo(3, 1)
    }
    await page.getByRole('button', { name: 'Print preview', exact: true }).click()
    await expect(page.frameLocator('iframe[title="Print preview"]').locator('.print-sheet')).toHaveCount(pdfPages)
    await page.getByRole('button', { name: 'Back to editor', exact: true }).click()
    expect(await body.evaluate((e) => JSON.stringify((e as HTMLElement & { editor: Editor }).editor.getJSON()))).toBe(
      before,
    )
    mkdirSync('docs/mvp3-gate/edges', { recursive: true })
    writeFileSync(
      `docs/mvp3-gate/edges/${kind}.json`,
      JSON.stringify({ kind, editorPages, pdfPages, verifiedLabels: labels.length, pdfBytes: bytes.length }, null, 2) +
        '\n',
    )
    writeFileSync(`docs/mvp3-gate/edges/${kind}-first.png`, inspected.pages[0].png)
    writeFileSync(`docs/mvp3-gate/edges/${kind}-last.png`, inspected.pages.at(-1)!.png)
  })

test('MVP 3 New clears long-document page chrome and old undo history', async ({ page }) => {
  await page.addInitScript(() => {
    window.confirm = () => true
  })
  await page.goto('./#/draft')
  const body = page.locator('.draft-paper .tiptap')
  await body.waitFor()
  await body.evaluate((element) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor
    editor.commands.setContent({
      type: 'doc',
      content: Array.from({ length: 12 }, (_, i) => ({
        type: 'paragraph',
        attrs: { pageBreakBefore: i ? 1 : null },
        content: [{ type: 'text', text: `OLD-DOC-${i}` }],
      })),
    })
  })
  await expect(page.locator('.draft-sheet')).toHaveCount(12)
  await page.getByRole('tab', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await expect(page.locator('.draft-sheet')).toHaveCount(1)
  await expect(page.locator('.draft-status-bar')).toContainText('Pages: 1')
  await expect(page.locator('.draft-status-bar')).toContainText('Current page: 1')
  await body.press('Control+z')
  await expect(body).not.toContainText('OLD-DOC')
})

test('MVP 3 unsupported scripts fail PDF explicitly without losing the source', async ({ page }) => {
  await page.goto('./#/draft')
  const body = page.locator('.draft-paper .tiptap')
  await body.fill('English Polski Ελληνικά العربية 中文')
  await page.getByRole('tab', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await page.getByRole('menuitem', { name: 'PDF', exact: true }).click()
  await expect(page.getByText('The document could not be exported. Please try again.', { exact: true })).toBeVisible()
  await expect(body).toContainText('Ελληνικά العربية 中文')
})

test('MVP 3 pagination, stories and PDF leave only static assets and preferences in storage', async ({
  page,
  context,
}) => {
  const requests: string[] = []
  context.on('request', (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url())
  })
  await page.addInitScript(() => {
    const audit = { writes: [] as Array<{ key: string; value: string }>, urls: 0 }
    Object.assign(window, { __mvp3Privacy: audit })
    const set = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      audit.writes.push({ key, value })
      return set.call(this, key, value)
    }
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL),
      urls = new Set<string>()
    URL.createObjectURL = (blob) => {
      const url = create(blob)
      urls.add(url)
      audit.urls = urls.size
      return url
    }
    URL.revokeObjectURL = (url) => {
      urls.delete(url)
      audit.urls = urls.size
      revoke(url)
    }
  })
  await page.goto('./#/draft')
  const body = page.locator('.draft-paper .tiptap')
  await body.waitFor()
  await body.evaluate((element) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor
    const setup = JSON.parse(editor.state.doc.attrs.pageSetup)
    setup.headerText = 'PRIVATE-MVP3-HEADER'
    setup.footerText = 'PRIVATE-MVP3-FOOTER'
    setup.pageNumbers = true
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'PRIVATE-MVP3-BODY' }] }],
    })
    editor.view.dispatch(editor.state.tr.setDocAttribute('pageSetup', JSON.stringify(setup)))
  })
  await pdfDownload(page)
  await page.getByRole('button', { name: 'Print preview', exact: true }).click()
  await expect(page.frameLocator('iframe[title="Print preview"]').locator('svg')).toContainText('PRIVATE-MVP3-HEADER')
  await page.getByRole('button', { name: 'Back to editor', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __mvp3Privacy: { urls: number } }).__mvp3Privacy.urls))
    .toBe(0)
  const storage = await page.evaluate(async () => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
    cookies: document.cookie,
    databases: await indexedDB.databases(),
    caches: (
      await Promise.all(
        (await caches.keys()).map(async (key) => (await (await caches.open(key)).keys()).map((request) => request.url)),
      )
    ).flat(),
    audit: (window as unknown as { __mvp3Privacy: object }).__mvp3Privacy,
    measurementRoots: document.querySelectorAll('.draft-reference-measure').length,
  }))
  expect(JSON.stringify(storage)).not.toContain('PRIVATE-MVP3')
  expect(storage.session).toEqual({})
  expect(storage.databases).toEqual([])
  expect(storage.cookies).toBe('')
  expect(storage.measurementRoots).toBe(0)
  expect(
    Object.keys(storage.local).every((key) =>
      ['allsuite:locale', 'allsuite:theme', 'allsuite:draft:view-preferences', 'allsuite:draft:image-options'].includes(
        key,
      ),
    ),
  ).toBe(true)
  expect(
    storage.caches.every((url) =>
      /\/AllSuite\/(?:$|assets\/|index\.html|third-party-licenses\.txt|manifest\.webmanifest|icons\/|registerSW\.js)/.test(
        url,
      ),
    ),
  ).toBe(true)
  expect(
    requests.every((url) => new URL(url).origin === new URL(page.url()).origin && !url.includes('PRIVATE-MVP3')),
  ).toBe(true)
  mkdirSync('docs/mvp3-gate', { recursive: true })
  writeFileSync(
    'docs/mvp3-gate/privacy.json',
    JSON.stringify({ ...storage, requestCount: requests.length, externalRequests: 0 }, null, 2) + '\n',
  )
})
