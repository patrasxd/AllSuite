import { test, expect } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'

test('applies default styles, clears direct overrides and preserves styles through DOCX save/reopen', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true })
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
  await page.goto('./#/draft')
  const editor = page.locator('.tiptap')
  await editor.focus()
  await editor.pressSequentially('First paragraph')
  await editor.press('Enter')
  await editor.pressSequentially('Second paragraph')
  await editor.press('Control+a')
  const picker = page.getByRole('combobox', { name: 'Text style', exact: true })
  await picker.selectOption('Heading2')
  await expect(editor.locator('h2')).toHaveCount(2)
  const size = page.getByRole('textbox', { name: 'Font size (pt)', exact: true })
  await size.fill('24')
  await size.press('Enter')
  await expect(editor).toBeFocused()
  await expect(editor.locator('h2 span').first()).toHaveCSS('font-size', '32px')
  await page.getByRole('button', { name: 'Clear formatting', exact: true }).click()
  expect(
    await editor
      .locator('h2')
      .first()
      .evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize)),
  ).toBeCloseTo((22 * 4) / 3, 3)
  await expect(editor).toBeFocused()
  await editor.locator('h2').first().click()
  await expect(page.locator('.draft-status-bar')).not.toContainText('Selection:')
  await picker.selectOption('Code')
  await expect(editor.locator('p[data-draft-style="Code"]')).toHaveCount(1)
  await expect(editor.locator('h2')).toHaveCount(1)
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toMatch(/styleDefinitions|First paragraph/)
  await page.getByRole('tab', { name: 'File', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const chunks: Buffer[] = []
  for await (const chunk of await (await downloading).createReadStream()) chunks.push(Buffer.from(chunk))
  const bytes = Buffer.concat(chunks)
  const files = unzipSync(bytes)
  expect(strFromU8(files['word/styles.xml'])).toContain('w:styleId="Code"')
  expect(strFromU8(files['word/document.xml'])).toContain('<w:pStyle w:val="Heading2"')
  await page.getByRole('button', { name: 'New', exact: true }).click()
  const choosing = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await (
    await choosing
  ).setFiles({
    name: 'styles.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: bytes,
  })
  await expect(editor).toContainText('Second paragraph')
  await expect(editor.locator('p[data-draft-style="Code"]')).toHaveCount(1)
  await expect(editor.locator('h2[data-draft-style="Heading2"]')).toHaveCount(1)
})

test('uses the default next styles and returns to Paragraph through the same simple picker', async ({ page }) => {
  await page.goto('./#/draft')
  const editor = page.locator('.tiptap')
  const picker = page.getByRole('combobox', { name: 'Text style', exact: true })
  await editor.fill('A neutral title')
  await picker.selectOption('Title')
  await editor.press('End')
  await editor.press('Enter')
  await expect(picker).toHaveValue('Subtitle')
  await editor.pressSequentially('A short subtitle')
  await editor.press('Enter')
  await expect(picker).toHaveValue('Normal')
  await picker.selectOption('Quote')
  await picker.selectOption('Normal')
  await expect(picker).toHaveValue('Normal')
  await expect(picker.locator('option')).toHaveCount(12)
  await expect(page.getByRole('combobox', { name: 'Character style', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Create style|Update style|Edit style|Reset to Normal/ })).toHaveCount(
    0,
  )
})

for (const theme of ['dark', 'light', 'e-ink-light', 'e-ink-dark']) {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 820, height: 1180 },
    { width: 1280, height: 800 },
    { width: 1920, height: 1080 },
  ]) {
    test(`styles viewport ${theme} ${viewport.width}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.addInitScript(
        ({ theme, locale }) => {
          localStorage.setItem('allsuite:theme', theme)
          localStorage.setItem('allsuite:locale', locale)
        },
        { theme, locale: viewport.width === 390 ? 'pl' : 'en' },
      )
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto('./#/draft')
      const picker = page.getByRole('combobox', {
        name: viewport.width === 390 ? 'Styl tekstu' : 'Text style',
        exact: true,
      })
      const editor = page.locator('.tiptap')
      await editor.fill('Neutral document styles')
      await picker.selectOption('Title')
      await editor.press('End')
      await editor.press('Enter')
      await editor.pressSequentially('A clear hierarchy for your own work')
      await editor.press('Enter')
      await picker.selectOption('Code')
      await editor.pressSequentially('const draft = 1')
      await expect(page.locator('.draft-status-bar')).toContainText('75')
      await expect
        .poll(() =>
          page.evaluate(() =>
            Array.from(document.fonts).some((face) => face.family.includes('Cousine') && face.status === 'loaded'),
          ),
        )
        .toBe(true)
      await page.evaluate(() => document.fonts.ready)
      await page.locator('.draft-document-area').evaluate((element) => element.scrollTo(0, 0))
      await expect(editor.getByText('Neutral document styles', { exact: true })).toBeInViewport()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width)
      expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(0)
      if (viewport.width <= 900) expect((await picker.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await page.screenshot({ path: `test-results/styles-${theme}-${viewport.width}.png` })
      if (viewport.width === 390 || viewport.width === 1280)
        await expect(page).toHaveScreenshot(`styles-${theme}-${viewport.width}.png`)
      expect((await page.locator('.draft-document-area').boundingBox())!.height).toBeGreaterThan(80)
    })
  }
}
