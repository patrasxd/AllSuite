import { expect, test, type Page } from '@playwright/test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const syntheticDocument = () =>
  Buffer.from(
    zipSync({
      'word/document.xml':
        strToU8(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:bookmarkStart w:id="1" w:name="intro"/><w:r><w:t>Introduction</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:bookmarkStart w:id="2" w:name="detail"/><w:r><w:t>Details</w:t></w:r><w:bookmarkEnd w:id="2"/></w:p>
    <w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> TOC \\o "1-3" \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p>
    <w:p><w:hyperlink w:anchor="intro"><w:r><w:t>Introduction</w:t></w:r></w:hyperlink></w:p>
    <w:p><w:pPr><w:pStyle w:val="TOC2"/></w:pPr><w:hyperlink w:anchor="detail"><w:r><w:t>Details</w:t></w:r></w:hyperlink></w:p>
    <w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
    <w:p><w:r><w:t>Follow this reference: </w:t></w:r><w:fldSimple w:instr="REF intro \\h"><w:r><w:t>Introduction</w:t></w:r></w:fldSimple><w:r><w:footnoteReference w:id="1"/></w:r></w:p>
    ${Array.from({ length: 24 }, (_, i) => `<w:p><w:r><w:t>Paragraph ${i + 1}. A synthetic document for navigation and scrolling checks.</w:t></w:r></w:p>`).join('')}
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Conclusion</w:t></w:r></w:p><w:p><w:r><w:t>Final paragraph.</w:t></w:r></w:p>
  </w:body></w:document>`),
      'word/footnotes.xml': strToU8(
        '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t>A synthetic source note.</w:t></w:r></w:p></w:footnote></w:footnotes>',
      ),
    }),
  )

async function openFile(page: Page, buffer: Buffer, locale = 'en') {
  await page.getByRole('tab', { name: locale === 'en' ? 'File' : 'Plik', exact: true }).click()
  const choosing = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: locale === 'en' ? 'Open' : 'Otwórz', exact: true }).click()
  await (await choosing).setFiles({ name: 'references.docx', mimeType, buffer })
}
async function references(page: Page, kind: string) {
  await page.getByRole('tab', { name: 'Insert', exact: true }).click()
  await page.getByRole('button', { name: 'References', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'References', exact: true })
  await dialog.getByRole('combobox', { name: 'Reference type', exact: true }).selectOption(kind)
  return dialog
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true })
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
})

test('Ctrl+K validates, edits and removes links; references and notes survive Save/New/Open', async ({ page }) => {
  await page.goto('./#/draft')
  const editor = page.locator('.tiptap')
  await editor.fill('Introduction')
  await editor.press('Control+Alt+1')
  await editor.press('End')
  await editor.press('Enter')
  await editor.pressSequentially('Bookmarked body')
  await editor.press('Home')
  await editor.press('Shift+End')
  let dialog = await references(page, 'bookmark')
  await dialog.getByRole('textbox', { name: 'Bookmark name', exact: true }).fill('body')
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click()
  await expect(editor.locator('[data-draft-bookmark="body"]')).toHaveText('Bookmarked body')
  await editor.press('Control+End')
  await editor.press('Enter')
  await editor.press('Control+k')
  dialog = page.getByRole('dialog', { name: 'Link', exact: true })
  await expect(dialog.getByRole('textbox', { name: 'Address', exact: true })).toBeFocused()
  await dialog.getByRole('textbox', { name: 'Address', exact: true }).fill('javascript:alert(1)')
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Address', exact: true }).fill('https://example.test')
  await dialog.getByRole('textbox', { name: 'Link text', exact: true }).fill('Website')
  await dialog.getByRole('textbox', { name: 'Address', exact: true }).press('Enter')
  await expect(editor.locator('a[href="https://example.test"]')).toHaveAttribute('rel', 'noopener noreferrer')
  await editor.locator('a[href="https://example.test"]').click()
  await page.getByRole('button', { name: 'Edit link', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Link', exact: true })
  await dialog.getByRole('textbox', { name: 'Address', exact: true }).fill('mailto:reader@example.test')
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(editor.locator('a[href="mailto:reader@example.test"]')).toHaveAttribute('target', '_blank')
  await page.getByRole('button', { name: 'Remove link', exact: true }).click()
  await expect(editor.locator('a[href="mailto:reader@example.test"]')).toHaveCount(0)
  await editor.press('Control+End')
  await editor.press('Enter')
  dialog = await references(page, 'toc')
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(editor.locator('[data-draft-toc] .draft-toc-label')).toHaveText(['Introduction'])
  await editor.press('Control+End')
  await editor.press('ArrowDown')
  await editor.press('Enter')
  dialog = await references(page, 'cross')
  await dialog.getByRole('combobox', { name: 'Target', exact: true }).selectOption('body')
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click()
  await expect(editor.locator('[data-draft-ref="body"]')).toHaveText('Bookmarked body')
  dialog = await references(page, 'footnote')
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click()
  await expect(editor).toBeFocused()
  await page.keyboard.type('Footnote source')
  await expect(editor.locator('.draft-note')).toContainText('Footnote source')
  await editor.locator('.draft-note-back').click()
  await expect(editor).toBeFocused()
  dialog = await references(page, 'endnote')
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click()
  await expect(editor).toBeFocused()
  await page.keyboard.type('Endnote source')
  await expect(editor.locator('.draft-note[data-kind="endnote"]')).toContainText('Endnote source')
  await page.getByRole('tab', { name: 'File', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const chunks: Buffer[] = []
  for await (const chunk of await (await downloading).createReadStream()) chunks.push(Buffer.from(chunk))
  const bytes = Buffer.concat(chunks)
  const files = unzipSync(bytes)
  expect(strFromU8(files['word/document.xml'])).toContain('TOC \\o')
  expect(strFromU8(files['word/document.xml'])).toContain('REF body')
  expect(strFromU8(files['word/footnotes.xml'])).toContain('Footnote source')
  expect(strFromU8(files['word/endnotes.xml'])).toContain('Endnote source')
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await expect(editor).toBeEmpty()
  await editor.press('Control+z')
  await expect(editor).toBeEmpty()
  await openFile(page, bytes)
  await expect(editor.locator('[data-draft-toc]')).toContainText('Introduction')
  await expect(editor.locator('[data-draft-ref="body"]')).toHaveText('Bookmarked body')
  await expect(editor.locator('.draft-note[data-kind="footnote"]')).toContainText('Footnote source')
  await expect(editor.locator('.draft-note[data-kind="endnote"]')).toContainText('Endnote source')
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toMatch(/Footnote source|Introduction|body|REF /)
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([])
})

test('TOC and REF fields update on demand, links jump, and heading navigation follows clicks and scrolling', async ({
  page,
}) => {
  await page.goto('./#/draft')
  await openFile(page, syntheticDocument())
  const editor = page.locator('.tiptap')
  await expect(editor.locator('h1').first()).toHaveText('Introduction')
  await editor.locator('h1').first().fill('Renamed introduction')
  await expect(editor.locator('[data-draft-toc]')).toContainText('Introduction')
  await expect(editor.locator('[data-draft-ref]')).toHaveText('Introduction')
  const dialog = await references(page, 'toc')
  await dialog.getByRole('button', { name: 'Update reference', exact: true }).click()
  await expect(editor.locator('[data-draft-toc]')).toContainText('Renamed introduction')
  await expect(editor.locator('[data-draft-ref]')).toHaveText('Renamed introduction')
  await editor.locator('[data-draft-toc] a').first().click()
  await expect(editor).toBeFocused()
  await expect(editor.locator('h1').first()).toBeInViewport()
  await page.getByRole('tab', { name: 'View', exact: true }).click()
  await page.getByRole('button', { name: 'Navigation', exact: true }).click()
  const navigation = page.getByRole('navigation', { name: 'Navigation', exact: true })
  await navigation.getByRole('button', { name: 'Collapse Renamed introduction', exact: true }).click()
  await expect(navigation.getByRole('button', { name: 'Details', exact: true })).toHaveCount(0)
  await navigation.getByRole('button', { name: 'Expand Renamed introduction', exact: true }).click()
  await navigation.getByRole('button', { name: 'Conclusion', exact: true }).click()
  await expect(navigation.getByRole('button', { name: 'Conclusion', exact: true })).toHaveAttribute(
    'aria-current',
    'location',
  )
  await expect(editor.getByRole('heading', { name: 'Conclusion', exact: true })).toBeInViewport()
  await page.locator('.draft-document-area').evaluate((element) => element.scrollTo(0, 0))
  await expect(navigation.getByRole('button', { name: 'Renamed introduction', exact: true })).toHaveAttribute(
    'aria-current',
    'location',
  )
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('150')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280)
  expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(0)
})

for (const locale of ['en', 'pl'])
  for (const theme of ['dark', 'light', 'e-ink-light', 'e-ink-dark']) {
    test(`reference dialogs use compact AllUI controls ${locale} ${theme}`, async ({ page }) => {
      await page.setViewportSize(locale === 'en' ? { width: 1280, height: 800 } : { width: 390, height: 844 })
      await page.addInitScript(
        ({ locale, theme }) => {
          localStorage.setItem('allsuite:locale', locale)
          localStorage.setItem('allsuite:theme', theme)
        },
        { locale, theme },
      )
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto('./#/draft')
      const editor = page.locator('.tiptap')
      await editor.fill('Synthetic reference text')
      await editor.press('Control+k')
      const link = page.getByRole('dialog', { name: 'Link', exact: true })
      await expect(
        link.getByRole('textbox', { name: locale === 'en' ? 'Address' : 'Adres', exact: true }),
      ).toBeFocused()
      await expect(link).toHaveCSS('opacity', '1')
      await page.screenshot({ path: `test-results/link-dialog-${locale}-${theme}.png` })
      await page.keyboard.press('Escape')
      await expect(link).toHaveCount(0)
      await page.getByRole('tab', { name: locale === 'en' ? 'Insert' : 'Wstawianie', exact: true }).click()
      const title = locale === 'en' ? 'References' : 'Odwołania'
      await page.getByRole('button', { name: title, exact: true }).click()
      const dialog = page.getByRole('dialog', { name: title, exact: true })
      await dialog
        .getByRole('combobox', { name: locale === 'en' ? 'Reference type' : 'Typ odwołania', exact: true })
        .selectOption('toc')
      await expect(dialog).toHaveCSS('opacity', '1')
      for (const select of await dialog.getByRole('combobox').all())
        expect(
          await select.evaluate((node) =>
            node.closest('.all-select-container')!.classList.contains('all-select-container--compact'),
          ),
        ).toBe(true)
      if (locale === 'pl')
        for (const control of await dialog.locator('button,input,select').all()) {
          const box = (await control.boundingBox())!
          const bounds = (await dialog.boundingBox())!
          expect(box.height).toBeGreaterThanOrEqual(44)
          expect(box.width).toBeGreaterThanOrEqual(44)
          expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width)
        }
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({ path: `test-results/reference-dialog-${locale}-${theme}.png` })
      await expect(page).toHaveScreenshot(`reference-dialog-${locale}-${theme}.png`)
    })
  }

for (const theme of ['dark', 'light', 'e-ink-light', 'e-ink-dark'])
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 820, height: 1180 },
    { width: 1280, height: 800 },
    { width: 1920, height: 1080 },
  ]) {
    test(`references viewport ${theme} ${viewport.width}`, async ({ page }) => {
      const locale = viewport.width === 390 ? 'pl' : 'en'
      await page.setViewportSize(viewport)
      await page.addInitScript(
        ({ theme, locale }) => {
          localStorage.setItem('allsuite:theme', theme)
          localStorage.setItem('allsuite:locale', locale)
        },
        { theme, locale },
      )
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto('./#/draft')
      await openFile(page, syntheticDocument(), locale)
      await expect(page.locator('.tiptap h1').first()).toHaveText('Introduction')
      await page.getByRole('tab', { name: locale === 'pl' ? 'Widok' : 'View', exact: true }).click()
      const title = locale === 'pl' ? 'Nawigacja' : 'Navigation'
      await page.getByRole('button', { name: title, exact: true }).click()
      const nav = page.getByRole('navigation', { name: title, exact: true })
      await expect(nav).toBeVisible()
      if (viewport.width < 600) await expect(page.getByRole('dialog', { name: title, exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width)
      expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(0)
      for (const button of await nav.getByRole('button').all()) {
        const box = (await button.boundingBox())!
        expect(box.height).toBeGreaterThanOrEqual(44)
        expect(box.width).toBeGreaterThanOrEqual(44)
      }
      await page.evaluate(() => document.fonts.ready)
      await page.locator('.draft-document-area').evaluate((element) => element.scrollTo(0, 0))
      await page.screenshot({ path: `test-results/references-${theme}-${viewport.width}.png` })
      // Viewing a cached field must not turn inherited heading formatting into a document edit.
      await expect(page.locator('.tiptap h1 strong, .tiptap h2 strong')).toHaveCount(0)
      await expect(page.getByRole('status')).toContainText(locale === 'pl' ? 'Gotowe' : 'Ready')
      if (viewport.width === 390 || viewport.width === 1280)
        await expect(page).toHaveScreenshot(`references-${theme}-${viewport.width}.png`)
      await nav.getByRole('button', { name: 'Conclusion', exact: true }).click()
      if (viewport.width < 600) await expect(page.getByRole('dialog', { name: title, exact: true })).toHaveCount(0)
      await expect(page.locator('.tiptap').getByRole('heading', { name: 'Conclusion', exact: true })).toBeInViewport()
      expect((await page.locator('.draft-document-area').boundingBox())!.height).toBeGreaterThan(80)
    })
  }
