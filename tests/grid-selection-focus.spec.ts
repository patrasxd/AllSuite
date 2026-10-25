import { expect, test } from '@playwright/test'

test('Grid shows active-cell keyboard focus without an outer scroller line', async ({ page }) => {
  await page.goto('./#/grid')
  const grid = page.getByRole('grid', { name: 'Spreadsheet grid', exact: true })
  const originalBounds = await grid.boundingBox()
  await page.locator('[data-cell-address="B2"]').click()
  await expect(grid).toBeFocused()
  await expect(grid).toHaveCSS('outline-style', 'none')
  await expect(page.locator('[data-cell-address="B2"]')).toHaveCSS('outline-style', 'solid')
  expect(await grid.boundingBox()).toEqual(originalBounds)

  await grid.press('ArrowRight')
  await expect(grid).toHaveAttribute('aria-activedescendant', 'grid-cell-C2')
  expect(await grid.evaluate((element) => element.matches(':focus-visible'))).toBe(true)
  await expect(page.locator('[data-cell-address="C2"]')).toHaveCSS('outline-width', '3px')
  await expect(grid).toHaveCSS('outline-style', 'none')

  await grid.press('F2')
  await expect(page.locator('.grid-cell-editor')).toBeFocused()
  await expect(page.locator('.grid-cell-editor')).toHaveCSS('outline-style', 'solid')
  await page.keyboard.press('Escape')
  await expect(grid).toBeFocused()
  const formula = page.getByRole('textbox', { name: 'Formula bar', exact: true })
  await formula.focus()
  await expect(page.locator('.grid-formula-field .all-input-wrapper')).toHaveCSS('outline-style', 'solid')
})
