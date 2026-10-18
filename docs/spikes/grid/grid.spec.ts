import { expect, test } from '@playwright/test'
const pageUrl = 'http://127.0.0.1:5187/docs/spikes/grid/grid-poc.html'

test('100 by 100 grid scrolls, edits and exposes bounded accessible cells', async ({ page }) => {
  await page.goto(pageUrl)
  const grid = page.getByRole('grid', { name: 'Proof sheet, 100 rows by 100 columns' })
  await expect(grid).toHaveAttribute('aria-rowcount', '100')
  await expect(grid).toHaveAttribute('aria-colcount', '100')
  await grid.focus()
  await expect(page.locator('#cell-0-0')).toHaveAttribute('aria-label', 'A1 Grid proof')
  const initialCells = await page.getByRole('gridcell').count()
  expect(initialCells).toBeLessThan(500)

  await page.keyboard.press('ArrowDown')
  await expect(page.locator('#selection-status')).toHaveText('A2')
  await page.keyboard.press('F2')
  const editor = page.getByRole('textbox', { name: 'Edit A2' })
  await editor.fill('changed')
  await editor.press('Enter')
  await expect(page.locator('#cell-1-0')).toHaveAttribute('aria-label', 'A2 changed')
  await grid.focus()
  await page.keyboard.press('Tab')
  await expect(page.locator('#selection-status')).toHaveText('B2')

  await grid.evaluate((element) => {
    element.scrollTop = 900
    element.scrollLeft = 1000
  })
  await expect.poll(() => grid.evaluate((element) => element.scrollTop)).toBeGreaterThan(500)
  await grid.focus()
  await page.keyboard.press('Control+End')
  await expect(page.locator('#selection-status')).toHaveText('CV100')
  const scrolledCells = await page.getByRole('gridcell').count()
  expect(scrolledCells).toBeLessThan(500)
})
