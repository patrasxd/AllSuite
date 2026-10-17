import { test, expect } from '@playwright/test'
import type { Editor } from '@tiptap/core'

test('HTML clipboard tables retain formatting through file save and reopen', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true })
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
  const remote: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('unsafe.test')) remote.push(request.url())
  })
  await page.goto('./#/draft')
  const editor = page.locator('.tiptap')
  await editor.focus()
  await editor.evaluate((element) => {
    const data = new DataTransfer()
    data.setData(
      'text/html',
      '<table><colgroup><col width="120"><col width="180"></colgroup><thead><tr><th colspan="2" style="background-color:#ffeeaa;border:2px solid #123456;padding:8px">Header</th></tr></thead><tbody><tr><td rowspan="2">Tall</td><td>B</td></tr><tr><td>C<img src="https://unsafe.test/table"><script>evil()</script></td></tr></tbody></table>',
    )
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
  })
  await expect(editor.locator('th')).toHaveText('Header')
  await expect(editor.locator('th')).toHaveCSS('background-color', 'rgb(255, 238, 170)')
  await expect(editor.locator('img,script')).toHaveCount(0)
  await page.getByRole('tab', { name: 'File', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const download = await downloading
  const chunks: Buffer[] = []
  for await (const chunk of await download.createReadStream()) chunks.push(Buffer.from(chunk))
  await expect(page.getByRole('status')).toContainText('Ready')
  await page.getByRole('button', { name: 'New', exact: true }).click()
  const choosing = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await (
    await choosing
  ).setFiles({
    name: 'tables.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.concat(chunks),
  })
  await expect(editor.locator('th')).toHaveText('Header')
  await expect(editor.locator('th')).toHaveAttribute('colspan', '2')
  await expect(editor.locator('th')).toHaveAttribute('colwidth', '120,180')
  await expect(editor.locator('th')).toHaveCSS('background-color', 'rgb(255, 238, 170)')
  await expect(editor.locator('th')).toHaveCSS('border-top-color', 'rgb(18, 52, 86)')
  await expect(editor.locator('tr').first()).toHaveAttribute('data-repeat-header', 'true')
  await expect(editor.locator('td[rowspan="2"]')).toHaveText('Tall')
  expect(remote).toEqual([])
})

test('table insertion, keyboard navigation, cell ranges, resizing and contextual controls', async ({ page }) => {
  await page.goto('./#/draft')
  await expect(page.getByRole('toolbar', { name: 'Table tools', exact: true })).toHaveCount(0)
  await page.getByRole('tab', { name: 'Insert', exact: true }).click()
  await page.getByRole('button', { name: 'Insert table', exact: true }).click()
  await page.getByRole('button', { name: '2 × 3', exact: true }).click()
  const table = page.locator('.tiptap table')
  await expect(table.locator('tr')).toHaveCount(2)
  await expect(page.getByRole('toolbar', { name: 'Table tools', exact: true })).toBeVisible()
  await page.keyboard.type('A')
  await page.keyboard.press('Tab')
  await page.keyboard.type('B')
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('End')
  await page.keyboard.press('ArrowRight')
  // Native table editing maps arrows at cell boundaries to the adjacent cell.
  await page.keyboard.type('C')
  await expect(table.locator('th').nth(1)).toContainText('C')
  await table.locator('td').last().click()
  await expect
    .poll(() =>
      page
        .locator('.tiptap')
        .evaluate((el) => (el as HTMLElement & { editor: Editor }).editor.state.selection.$from.index(-2)),
    )
    .toBe(2)
  await page.keyboard.press('Tab')
  await expect(table.locator('tr')).toHaveCount(3)
  await page.keyboard.press('Shift+ArrowRight')
  // Drag across two cells to form a rectangular CellSelection.
  const first = await table.locator('td').nth(0).boundingBox()
  const second = await table.locator('td').nth(1).boundingBox()
  await page.mouse.move(first!.x + 8, first!.y + 8)
  await page.mouse.down()
  await page.mouse.move(second!.x + second!.width - 8, second!.y + 8, { steps: 10 })
  await page.mouse.up()
  await expect(table.locator('.selectedCell')).toHaveCount(2)
  await page.getByRole('button', { name: 'Merge cells', exact: true }).click()
  await expect(table.locator('td[colspan="2"]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Split cell', exact: true }).click()
  await expect(table.locator('td[colspan="2"]')).toHaveCount(0)
  await table.locator('th').first().click()
  const before = await table.locator('th').first().boundingBox()
  await page.mouse.move(before!.x + before!.width - 1, before!.y + 10)
  await page.mouse.down()
  await page.mouse.move(before!.x + before!.width + 45, before!.y + 10, { steps: 10 })
  await page.mouse.up()
  await expect
    .poll(async () => (await table.locator('th').first().boundingBox())!.width)
    .toBeGreaterThan(before!.width + 20)
  await page.getByRole('button', { name: 'Repeat header row', exact: true }).click()
  await expect(table.locator('tr').first()).toHaveAttribute('data-repeat-header', 'true')
  await page.getByRole('combobox', { name: 'Table alignment', exact: true }).selectOption('right')
  await expect(table).toHaveCSS('margin-right', '0px')
  await page.getByRole('button', { name: 'Delete table', exact: true }).click()
  await expect(page.getByRole('toolbar', { name: 'Table tools', exact: true })).toHaveCount(0)
})

for (const theme of ['dark', 'light', 'e-ink-light', 'e-ink-dark']) {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 820, height: 1180 },
    { width: 1280, height: 800 },
    { width: 1920, height: 1080 },
  ]) {
    test(`table viewport ${theme} ${viewport.width}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.addInitScript((theme) => localStorage.setItem('allsuite:theme', theme), theme)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto('./#/draft')
      await page.getByRole('tab', { name: 'Insert', exact: true }).click()
      await page.getByRole('button', { name: 'Insert table', exact: true }).click()
      await page.getByRole('spinbutton', { name: 'Columns', exact: true }).fill('20')
      await page.getByRole('dialog').getByRole('button', { name: 'Insert table', exact: true }).click()
      await page.keyboard.type('Synthetic table audit')
      await expect(page.locator('.tiptap th p').first()).toHaveCSS('font-family', 'system-ui, sans-serif')
      await expect(page.locator('.tiptap table')).toBeVisible()
      const wrapper = page.locator('.tableWrapper')
      expect(await wrapper.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
      await wrapper.evaluate((el) => el.scrollTo(el.scrollWidth, 0))
      expect(await wrapper.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
      await wrapper.evaluate((el) => el.scrollTo(0, 0))
      const toolbar = page.getByRole('toolbar', { name: 'Table tools', exact: true })
      for (const control of await toolbar.locator('button, input, select').all()) {
        const box = await control.boundingBox()
        expect(box!.height).toBeGreaterThanOrEqual(44)
        expect(box!.width).toBeGreaterThanOrEqual(44)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width)
      const pane = await page.locator('.draft-document-area').boundingBox()
      expect(pane!.height).toBeGreaterThan(80)
      await page.screenshot({ path: `test-results/table-${theme}-${viewport.width}.png` })
      if (viewport.width === 390 || viewport.width === 1280) {
        await expect(page).toHaveScreenshot(`table-${theme}-${viewport.width}.png`)
      }
    })
  }
}
