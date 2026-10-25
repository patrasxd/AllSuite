import { expect, test } from '@playwright/test'

test('@smoke Grid extends disjoint selections and supports reverse and boundary keyboard navigation', async ({
  page,
}) => {
  await page.goto('./#/grid')
  const grid = page.getByRole('grid', { name: 'Spreadsheet grid' })
  const nameBox = page.getByRole('textbox', { name: 'Name box' })
  await page.locator('[data-cell-address="A1"]').click()
  await page.locator('[data-cell-address="C3"]').click({ modifiers: ['Control'] })
  await grid.press('Shift+ArrowDown')
  await grid.press('Shift+ArrowDown')
  await expect(page.locator('[data-cell-address="A1"]')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[data-cell-address="B2"]')).toHaveAttribute('aria-selected', 'false')
  await expect(page.locator('[data-cell-address="C5"]')).toHaveAttribute('aria-selected', 'true')
  await expect(grid).toHaveAttribute('aria-multiselectable', 'true')
  await grid.press('Home')
  await grid.press('Shift+Tab')
  await expect(nameBox).toHaveValue('Z4')
  await expect(grid).toHaveAttribute('aria-activedescendant', 'grid-cell-Z4')
  await grid.press('Shift+Enter')
  await expect(nameBox).toHaveValue('Z3')
  await expect(grid).toHaveAttribute('aria-activedescendant', 'grid-cell-Z3')
  await grid.press('Control+Shift+Home')
  await expect(nameBox).toHaveValue('A1:Z3')
  await expect(grid).toHaveAttribute('aria-activedescendant', 'grid-cell-A1')
  await grid.press('Control+Home')
  await grid.press('PageDown')
  await expect(nameBox).not.toHaveValue('A1')
  await grid.press('Control+Home')
  await grid.press('PageUp')
  await expect(nameBox).toHaveValue('A1')
  await expect(grid).toHaveAttribute('aria-activedescendant', 'grid-cell-A1')
})

test('@smoke Grid refreshes virtual dimensions when switching sheets and undoing resize', async ({ page }) => {
  await page.goto('./#/grid')
  const cell = page.locator('[data-cell-address="A1"]')
  const width = (await cell.boundingBox())!.width
  const resize = page.getByRole('slider', { name: 'Resize column A', exact: true })
  await resize.focus()
  await resize.press('ArrowRight')
  await expect.poll(async () => (await cell.boundingBox())!.width).toBe(width + 8)
  await resize.press('Tab')
  await expect(resize).not.toBeFocused()
  await page.getByRole('button', { name: 'Add sheet' }).click()
  await expect.poll(async () => (await cell.boundingBox())!.width).toBe(width)
  await page.getByRole('tab', { name: 'Sheet1', exact: true }).click()
  const grid = page.getByRole('grid')
  await expect(grid).toBeFocused()
  await expect.poll(async () => (await cell.boundingBox())!.width).toBe(width + 8)
  await grid.press('Control+z') // Undo adding Sheet2.
  await grid.press('Control+z') // Undo resizing Sheet1.
  await expect.poll(async () => (await cell.boundingBox())!.width).toBe(width)
})

test('@smoke Grid keeps an accessible active-cell proxy while scrolled away at high DPI', async ({ browser }) => {
  test.setTimeout(60_000)
  const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1280, height: 800 } })
  try {
    const page = await context.newPage()
    await page.goto('http://127.0.0.1:4176/AllSuite/#/grid')
    const grid = page.getByRole('grid')
    const nameBox = page.getByRole('textbox', { name: 'Name box' })
    await nameBox.fill('AZ500')
    await nameBox.press('Enter')
    await expect(nameBox).toHaveValue('AZ500')
    const active = page.locator('#grid-cell-AZ500')
    await expect(active).toBeInViewport()
    await expect(grid).toBeFocused()
    await grid.evaluate((element) => {
      element.scrollTop = 0
      element.scrollLeft = 0
    })
    await expect(grid).toHaveAttribute('aria-activedescendant', 'grid-active-cell-proxy')
    await expect(page.locator('#grid-active-cell-proxy')).toHaveAttribute('aria-label', 'AZ500, empty')
    expect(await page.getByRole('gridcell').count()).toBeLessThan(800)
    await grid.press('ArrowRight')
    await expect(page.locator('#grid-cell-BA500')).toBeInViewport()
    await expect(grid).toBeFocused()
  } finally {
    await context.close()
  }
})

test('@smoke Grid cancels touch resize without changing workbook dimensions', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })
  try {
    const page = await context.newPage()
    await page.goto('http://127.0.0.1:4176/AllSuite/#/grid')
    const resize = page.getByRole('slider', { name: 'Resize column A', exact: true })
    const value = await resize.getAttribute('aria-valuenow')
    await resize.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 3, clientX: 150, button: 0 })
    await resize.dispatchEvent('pointermove', { pointerType: 'touch', pointerId: 3, clientX: 200, buttons: 1 })
    await expect(resize).not.toHaveAttribute('aria-valuenow', value!)
    await resize.dispatchEvent('pointercancel', { pointerType: 'touch', pointerId: 3 })
    await expect(resize).toHaveAttribute('aria-valuenow', value!)
    await expect(page.getByRole('textbox', { name: 'Formula bar' })).toBeVisible()
  } finally {
    await context.close()
  }
})
