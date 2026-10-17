import { expect, test } from '@playwright/test'
import type { Editor } from '@tiptap/core'

test('rich story editing, fixed date, fields, variants, body reflow and undo', async ({ page }) => {
  await page.goto('./#/draft')
  const body = page.locator('.draft-paper .tiptap')
  await body.fill('Synthetic body')
  await body.evaluate((element) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor
    editor.commands.setContent({
      type: 'doc',
      content: Array.from({ length: 100 }, (_, i) => ({
        type: 'paragraph',
        content: [{ type: 'text', text: `Synthetic paragraph ${i}` }],
      })),
    })
  })
  await expect.poll(() => page.locator('.draft-sheet').count()).toBeGreaterThan(2)
  const before = await page.locator('.draft-sheet').count()
  await page.getByRole('tab', { name: 'Layout', exact: true }).click()
  await page.getByRole('button', { name: 'Page setup', exact: true }).click()
  await page.getByRole('button', { name: 'Edit rich headers and footers', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'Document title', exact: true }).fill('Synthetic title')
  await dialog.getByLabel('Different first page', { exact: true }).check()
  await dialog.getByLabel('Different odd/even pages', { exact: true }).check()
  await dialog.getByLabel('Starting page number', { exact: true }).fill('7')
  await dialog.getByLabel('Page number format', { exact: true }).selectOption('upperRoman')
  const story = dialog.locator('.tiptap')
  await story.pressSequentially('# Heading')
  expect(
    await story.evaluate((element) => (element as HTMLElement & { editor: Editor }).editor.getJSON().content![0].type),
  ).toBe('paragraph')
  await story.fill('ODD')
  await story.press('Control+End')
  await dialog.getByRole('button', { name: 'Page number', exact: true }).click()
  await dialog.getByRole('button', { name: 'Total pages', exact: true }).click()
  await dialog.getByRole('button', { name: 'Document title', exact: true }).click()
  await dialog.getByRole('button', { name: 'Insert date', exact: true }).click()
  const date = new Date().toLocaleDateString('en-GB')
  await expect(story).toContainText(date)
  await dialog
    .getByRole('combobox', { name: 'Edit rich headers and footers', exact: true })
    .selectOption('header:first')
  await story.fill('FIRST\n'.repeat(7))
  await story.press('Control+a')
  await dialog.getByRole('button', { name: 'Bold', exact: true }).click()
  await dialog.getByRole('combobox', { name: 'Edit rich headers and footers', exact: true }).selectOption('header:even')
  await story.fill('EVEN')
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.draft-page-band--top').nth(0)).toContainText('FIRST')
  await expect(page.locator('.draft-page-band--top').nth(1)).toContainText('EVEN')
  await expect(page.locator('.draft-page-band--top').nth(2)).toContainText('ODDIX')
  await expect(page.locator('.draft-page-band--top').nth(2)).toContainText('Synthetic title')
  await expect.poll(() => page.locator('.draft-sheet').count()).toBeGreaterThan(before)
  const overlap = await page.evaluate(() => {
    const header = document.querySelector('.draft-page-band--top .draft-story-content')!.getBoundingClientRect()
    const body = document.querySelector('.draft-paper .tiptap p')!.getBoundingClientRect()
    return header.bottom - body.top
  })
  expect(overlap).toBeLessThanOrEqual(0)
  await body.press('Control+z')
  await expect(page.locator('.draft-page-band--top').first()).not.toContainText('FIRST')
  expect(await body.textContent()).toContain('Synthetic paragraph 0')
  expect(await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage))).not.toMatch(
    /FIRST|ODD|Synthetic title|data:image/,
  )
})

test('header image is embedded and reduces body height; cancelling preserves the document', async ({ page }) => {
  await page.goto('./#/draft')
  const body = page.locator('.draft-paper .tiptap')
  await body.fill('Body stays in memory')
  const original = await body.evaluate((element) =>
    JSON.stringify((element as HTMLElement & { editor: Editor }).editor.getJSON()),
  )
  await page.getByRole('button', { name: 'Edit rich headers and footers — Header 1', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  })
  await expect(dialog.locator('.tiptap img[src]').first()).toBeVisible()
  expect(
    await dialog
      .locator('.tiptap')
      .evaluate(
        (element) =>
          (element as HTMLElement & { editor: Editor }).editor
            .getJSON()
            .content![0].content!.filter((node) => node.type === 'image').length,
      ),
  ).toBe(1)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(
    await body.evaluate((element) => JSON.stringify((element as HTMLElement & { editor: Editor }).editor.getJSON())),
  ).toBe(original)
  await page.getByRole('button', { name: 'Edit rich headers and footers — Header 1', exact: true }).click()
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 80
    canvas.height = 150
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#005577'
    ctx.fillRect(0, 0, 80, 150)
    return canvas.toDataURL().split(',')[1]
  })
  await dialog
    .locator('input[type=file]')
    .setInputFiles({ name: 'tall.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') })
  await expect(dialog.locator('.tiptap img[src]').first()).toBeVisible()
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(page.locator('.draft-page-band--top img')).toHaveCount(1)
  await expect
    .poll(() =>
      page
        .locator('.draft-page')
        .evaluate((element) => parseFloat(getComputedStyle(element).getPropertyValue('--draft-margin-top'))),
    )
    .toBeGreaterThan(190)
  await body.press('Control+z')
  expect(
    await body.evaluate((element) => JSON.stringify((element as HTMLElement & { editor: Editor }).editor.getJSON())),
  ).toBe(original)
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => !key.startsWith('allsuite:')))).toEqual([])
})
