import { expect, test, type Page } from '@playwright/test'
import type { Editor } from '@tiptap/core'
import { strToU8, zipSync } from 'fflate'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromiumPDFPages } from './fixtures/pdf-text'
import { generatedPNG } from './fixtures/png'

const evidence = 'docs/page-setup-audit'
const model = (page: Page) =>
  page.locator('.tiptap').evaluate((element) => (element as HTMLElement & { editor: Editor }).editor.getJSON())
async function openSetup(page: Page) {
  await page.getByRole('tab', { name: 'Layout', exact: true }).click()
  await page.getByRole('button', { name: 'Page setup', exact: true }).click()
  return page.getByRole('dialog', { name: 'Page setup', exact: true })
}
async function configure(page: Page) {
  const dialog = await openSetup(page)
  for (const [label, value] of [
    ['Width (mm)', '180'],
    ['Height (mm)', '240'],
    ['Top (mm)', '15'],
    ['Right (mm)', '17'],
    ['Bottom (mm)', '18'],
    ['Left (mm)', '19'],
    ['Header distance from top (mm)', '5'],
    ['Footer distance from bottom (mm)', '6'],
    ['Header text', 'Zażółć HEADER'],
    ['Footer text', 'STOPKA'],
  ])
    await dialog.getByRole('textbox', { name: label, exact: true }).fill(value)
  await dialog.getByRole('combobox', { name: 'Page numbers', exact: true }).selectOption('yes')
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

test('page setup is undoable, dirty, memory-only and survives DOCX save/open; New resets it', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true })
  })
  await page.goto('./#/draft')
  await expect(page.locator('.tiptap')).toBeVisible()
  const before = await model(page)
  await configure(page)
  const configured = await model(page)
  expect(configured.attrs?.pageSetup).not.toBe(before.attrs?.pageSetup)
  await expect(page.getByRole('status')).toContainText('Unsaved changes')
  await page.getByRole('tab', { name: 'Edit', exact: true }).click()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  expect((await model(page)).attrs?.pageSetup).toBe(before.attrs?.pageSetup)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  expect((await model(page)).attrs?.pageSetup).toBe(configured.attrs?.pageSetup)
  const dialog = await openSetup(page)
  await dialog.getByRole('textbox', { name: 'Left (mm)', exact: true }).fill('500')
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('valid dimensions')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await model(page)).attrs?.pageSetup).toBe(configured.attrs?.pageSetup)
  await page.getByRole('tab', { name: 'File', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const download = await downloading,
    chunks: Buffer[] = []
  for await (const chunk of await download.createReadStream()) chunks.push(Buffer.from(chunk))
  await expect(page.getByRole('status')).toContainText('Ready')
  await page.getByRole('button', { name: 'New', exact: true }).click()
  expect((await model(page)).attrs?.pageSetup).toBe(before.attrs?.pageSetup)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  const fileChooser = await chooser
  await fileChooser.setFiles({
    name: 'page-setup.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.concat(chunks),
  })
  await fileChooser.element().dispose()
  await expect(page.getByText('Opening document…')).toHaveCount(0)
  await expect
    .poll(
      async () => JSON.parse(String((await model(page)).attrs?.pageSetup)).stories?.header.default[0].content?.[0].text,
    )
    .toBe('Zażółć HEADER')
  const importedSetup = JSON.parse(String((await model(page)).attrs?.pageSetup))
  expect(importedSetup).toMatchObject({
    ...JSON.parse(String(configured.attrs?.pageSetup)),
    headerText: '',
    footerText: '',
    pageNumbers: false,
  })
  expect(
    importedSetup.stories.footer.default[0].content.some(
      (node: { type: string; attrs?: { field: string } }) =>
        node.type === 'storyField' && node.attrs?.field === 'NUMPAGES',
    ),
  ).toBe(true)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toMatch(/HEADER|STOPKA|pageSetup|headerText/)
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0)
  await page.getByRole('button', { name: 'New', exact: true }).click()
  expect((await model(page)).attrs?.pageSetup).toBe(before.attrs?.pageSetup)
})

test('semantic print uses physical setup, repeats headers, fragments long prose, fits images and keeps source/caret/history', async ({
  page,
  context,
}) => {
  test.setTimeout(60000)
  mkdirSync(evidence, { recursive: true })
  await context.addInitScript(() => {
    window.print = () => {
      document.documentElement.dataset.printRequested = 'true'
    }
  })
  await page.goto('./#/draft')
  await expect(page.locator('.tiptap')).toBeVisible()
  await configure(page)
  const png = Buffer.from(generatedPNG(200, 1400)).toString('base64')
  await page.locator('.tiptap').evaluate((element, png) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor
    const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
    editor.commands.setContent({
      ...editor.getJSON(),
      content: [
        p('PROSE-BEGIN ' + 'Zażółć gęślą jaźń. Natural wrapping paragraph. '.repeat(350) + ' PROSE-END'),
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              attrs: { repeatHeader: true },
              content: [{ type: 'tableHeader', attrs: { colspan: 2 }, content: [p('REPEATED-HEADER')] }],
            },
            ...Array.from({ length: 65 }, (_, i) => ({
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [p(`ROW-${String(i).padStart(3, '0')}`)] },
                { type: 'tableCell', content: [p('Polish zażółć')] },
              ],
            })),
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  attrs: { colspan: 2 },
                  content: [p('TALL-ROW-BEGIN ' + 'Tall row text. '.repeat(1000) + ' TALL-ROW-END')],
                },
              ],
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  attrs: { colspan: 2 },
                  content: [
                    {
                      type: 'table',
                      content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('NESTED-TABLE')] }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        p('IMAGE-BEFORE'),
        {
          type: 'paragraph',
          content: [
            {
              type: 'image',
              attrs: { src: `data:image/png;base64,${png}`, width: 200, height: 1400, alt: 'Tall synthetic image' },
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'BREAK-BEFORE' },
            { type: 'pageBreak' },
            { type: 'text', text: 'BREAK-AFTER' },
          ],
        },
        p('DOCUMENT-END'),
      ],
    })
    editor.commands.setTextSelection(5)
  }, png)
  const beforeEdit = JSON.stringify(await model(page))
  await page.locator('.tiptap').evaluate((element) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor
    // Undo/redo closes the synthetic fixture insertion's history group before this edit.
    editor.commands.undo()
    editor.commands.redo()
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.commands.insertContent('x')
  })
  const before = JSON.stringify(await model(page))
  const caret = await page
    .locator('.tiptap')
    .evaluate((e) => (e as HTMLElement & { editor: Editor }).editor.state.selection.from)
  await page.getByRole('tab', { name: 'File', exact: true }).click()
  const opening = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Print', exact: true }).click()
  const print = await opening
  await expect(print.locator('html')).toHaveAttribute('data-print-requested', 'true', { timeout: 20000 })
  await expect(print.locator('.print-sheet')).toHaveCount(await page.locator('.draft-sheet').count())
  expect(await print.evaluate(() => window.opener)).toBeNull()
  const rendering = await context.newPage()
  await rendering.setContent(await print.content())
  await rendering.evaluate(async () => {
    await Promise.all(Array.from(document.fonts, (face) => face.load()))
    await document.fonts.ready
    await Promise.all(Array.from(document.images, (image) => image.decode()))
  })
  const pdf = await rendering.pdf({
    path: `${evidence}/mixed-print.pdf`,
    preferCSSPageSize: true,
    printBackground: true,
  })
  const raw = pdf.toString('latin1'),
    media = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/.exec(raw)!
  expect(Number(media[1])).toBeCloseTo((180 * 72) / 25.4, 0)
  expect(Number(media[2])).toBeCloseTo((240 * 72) / 25.4, 0)
  const pages = chromiumPDFPages(pdf),
    text = pages.join('\n')
  writeFileSync(`${evidence}/mixed-print-pages.json`, JSON.stringify(pages, null, 2) + '\n')
  expect(pages.length).toBeGreaterThan(6)
  for (const label of ['PROSE-BEGIN', 'PROSE-END', 'TALL-ROW-BEGIN', 'TALL-ROW-END', 'NESTED-TABLE', 'DOCUMENT-END'])
    expect(text).toContain(label)
  expect(pages.filter((text) => text.includes('REPEATED-HEADER')).length).toBeGreaterThan(1)
  for (let i = 0; i < 65; i++) expect(text.match(new RegExp(`ROW-${String(i).padStart(3, '0')}`, 'g'))).toHaveLength(1)
  expect(pages.findIndex((text) => text.includes('BREAK-AFTER'))).toBeGreaterThan(
    pages.findIndex((text) => text.includes('BREAK-BEFORE')),
  )
  expect(pages.every((text) => text.includes('Zażółć HEADER') && text.includes('STOPKA'))).toBe(true)
  expect(text).not.toContain('�')
  await rendering.emulateMedia({ media: 'print' })
  const image = await rendering
    .locator('image')
    .evaluate((e) => ({ height: e.getBoundingClientRect().height, width: e.getBoundingClientRect().width }))
  expect(image.height).toBeLessThan(((240 - 15 - 18) * 96) / 25.4)
  expect(image.height / image.width).toBeCloseTo(7, 1)
  expect(JSON.stringify(await model(page))).toBe(before)
  expect(
    await page.locator('.tiptap').evaluate((e) => (e as HTMLElement & { editor: Editor }).editor.state.selection.from),
  ).toBe(caret)
  await page.locator('.tiptap').evaluate((e) => (e as HTMLElement & { editor: Editor }).editor.commands.undo())
  expect(JSON.stringify(await model(page))).toBe(beforeEdit)
  await page.locator('.tiptap').evaluate((e) => (e as HTMLElement & { editor: Editor }).editor.commands.redo())
  expect(JSON.stringify(await model(page))).toBe(before)
  await expect(page.getByRole('status')).toContainText('Unsaved changes')
  await print.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await expect.poll(() => print.isClosed()).toBe(true)
  await rendering.close()
})

test('explicit page breaks work in a two-column print projection', async ({ page, context }) => {
  await context.addInitScript(() => {
    window.print = () => {
      document.documentElement.dataset.printRequested = 'true'
    }
  })
  await page.goto('./#/draft')
  await expect(page.locator('.tiptap')).toBeVisible()
  await page.locator('.tiptap').evaluate((element) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor
    editor.commands.setContent({
      type: 'doc',
      attrs: { ...editor.getJSON().attrs, columns: 2 },
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'COLUMNS-BEFORE' },
            { type: 'pageBreak' },
            { type: 'text', text: 'COLUMNS-AFTER' },
          ],
        },
      ],
    })
    editor.view.dispatch(editor.state.tr.setDocAttribute('columns', 2))
  })
  await page.getByRole('tab', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: 'Print preview', exact: true }).click()
  await expect(page.getByText('Print preview requires a single-column document.', { exact: true })).toBeVisible()
  await expect(page.locator('iframe[title="Print preview"]')).toHaveCount(0)
  const popup = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Print', exact: true }).click()
  const print = await popup
  await expect(print.locator('html')).toHaveAttribute('data-print-requested', 'true')
  const rendering = await context.newPage()
  await rendering.setContent(await print.content())
  await rendering.evaluate(() => document.fonts.ready)
  const pages = chromiumPDFPages(await rendering.pdf({ preferCSSPageSize: true }))
  expect(pages).toHaveLength(2)
  expect(pages[0]).toContain('COLUMNS-BEFORE')
  expect(pages[1]).toContain('COLUMNS-AFTER')
  await print.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await rendering.close()
})

for (const theme of ['dark', 'light', 'e-ink-light', 'e-ink-dark']) {
  for (const [width, height] of [
    [390, 844],
    [844, 390],
    [820, 1180],
    [1280, 800],
    [1920, 1080],
  ]) {
    test(`page setup layout ${theme} ${width}`, async ({ page }) => {
      mkdirSync(evidence, { recursive: true })
      await page.setViewportSize({ width, height })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.addInitScript((theme) => {
        localStorage.setItem('allsuite:theme', theme)
      }, theme)
      await page.goto('./#/draft')
      const dialog = await openSetup(page)
      await expect(dialog.getByRole('textbox', { name: 'Width (mm)', exact: true })).toBeVisible()
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight,
        ),
      ).toBe(true)
      if (width === 390 || width === 1280) await expect(page).toHaveScreenshot(`page-setup-${theme}-${width}.png`)
      await page.screenshot({ path: `${evidence}/${theme}-${width}.png` })
      await dialog.getByRole('button', { name: 'Apply', exact: true }).scrollIntoViewIfNeeded()
      await expect(dialog.getByRole('button', { name: 'Apply', exact: true })).toBeVisible()
      if (width <= 900) {
        const bounds = await dialog.getByRole('button', { name: 'Apply', exact: true }).boundingBox()
        expect(bounds!.height).toBeGreaterThanOrEqual(44)
        expect(bounds!.width).toBeGreaterThanOrEqual(44)
      }
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(page.getByRole('toolbar', { name: 'Layout', exact: true })).toBeVisible()
    })
  }
}

test('Polish page settings and unsupported section report are localized', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('allsuite:locale', 'pl')
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true })
  })
  await page.goto('./#/draft')
  await page.getByRole('tab', { name: 'Układ', exact: true }).click()
  await page.getByRole('button', { name: 'Ustawienia strony', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Ustawienia strony', exact: true })
  await expect(dialog.getByRole('textbox', { name: 'Tekst nagłówka', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Anuluj', exact: true }).click()
  await page.getByRole('tab', { name: 'Plik', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Otwórz', exact: true }).click()
  const fileChooser = await chooser
  const bytes = zipSync({
    'word/document.xml': strToU8(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:sectPr/></w:pPr></w:p><w:sectPr/></w:body></w:document>',
    ),
  })
  await fileChooser.setFiles({
    name: 'sections.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from(bytes),
  })
  await fileChooser.element().dispose()
  await expect(page.getByRole('dialog')).toContainText('Wiele sekcji')
})
