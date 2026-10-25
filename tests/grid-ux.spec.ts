import { gridCommand } from './helpers/grid-command'
import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

test('Grid visual composition with real imported data and native table', async ({ page }) => {
  const phase = process.env.GRID_UX_PHASE ?? 'after'
  const directory = `docs/verification/assets/grid-ux-${phase}`
  await mkdir(directory, { recursive: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('./#/grid')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'Studio budget.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Item,Category,Units,Unit cost,Budget,Actual\nBrand identity,Design,1,2400,2400,2250\nLanding page,Design,1,3200,3200,3100\nPhotography,Content,2,650,1300,1200\nCopywriting,Content,1,900,900,810\nLaunch assets,Design,1,850,850,810\nPrint samples,Production,3,60,180,165\nPackaging,Production,1,750,750,690\nSocial campaign,Marketing,1,1100,1100,1050\nEmail campaign,Marketing,1,650,650,610\nVenue hire,Events,1,1200,1200,1150\nCatering,Events,1,500,500,580',
    ),
  })
  const preview = page.getByRole('dialog')
  await expect(preview).toBeVisible()
  await preview.getByRole('combobox', { name: 'Value types', exact: true }).selectOption('scalars')
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${directory}/csv.png` })
  await preview.getByRole('button', { name: 'Import workbook', exact: true }).click()
  await expect(page.locator('[data-cell-address="A2"]')).toHaveText('Brand identity')
  for (const [column, steps] of [
    ['A', 16],
    ['B', 6],
  ] as const) {
    const resize = page.getByRole('slider', { name: `Resize column ${column}`, exact: true })
    for (let step = 0; step < steps; step++) await resize.press('ArrowRight')
  }
  const range = page.getByRole('textbox', { name: 'Name box' })
  await range.fill('A1:F12')
  await range.press('Enter')
  for (const tab of ['File', 'Home', 'Insert', 'Data', 'View']) {
    await page.getByRole(tab === 'File' ? 'button' : 'tab', { name: tab, exact: true }).click()
    await page.mouse.move(0, 0)
    await page.waitForTimeout(250)
    await page.screenshot({ path: `${directory}/${tab.toLowerCase()}.png` })
  }
  await page
    .getByRole(phase === 'after' ? 'tab' : 'button', { name: phase === 'after' ? 'Home' : 'File', exact: true })
    .click()
  await (await gridCommand(page, 'Sort range')).click()
  await expect(page.getByRole('dialog', { name: 'Sort range' })).toBeVisible()
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${directory}/sort.png` })
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: 'Insert', exact: true }).click()
  await (await gridCommand(page, 'Create Table')).click()
  const dialog = page.getByRole('dialog', { name: 'Create Table', exact: true })
  await expect(dialog).toBeVisible()
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${directory}/create-table.png` })
  if (phase === 'after') {
    await dialog.getByRole('textbox', { name: 'Table name', exact: true }).fill('A1')
    await dialog.getByRole('button', { name: 'Create Table', exact: true }).click()
    await expect(dialog.getByRole('textbox', { name: 'Table name', exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await page.screenshot({ path: `${directory}/name-error.png` })
  }
  await dialog.getByRole('textbox', { name: 'Table name' }).fill('StudioBudget')
  await dialog.getByRole('button', { name: 'Create Table', exact: true }).click()
  await expect(page.locator('[data-cell-address="A1"]')).toHaveAttribute('data-table-role', 'header')
  await expect(page.getByRole('grid')).toBeFocused()
  await range.fill('F6')
  await range.press('Enter')
  await expect(range).toHaveValue('F6')
  if (phase === 'after') await page.getByRole('tab', { name: 'Table', exact: true }).click()
  else await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.screenshot({ path: `${directory}/table.png` })
  if (phase === 'after') await page.getByRole('button', { name: 'AutoFilter: Category', exact: true }).click()
  else await (await gridCommand(page, 'AutoFilter')).click()
  if (phase === 'after')
    await expect(page.getByRole('dialog').getByRole('combobox', { name: 'Filter column', exact: true })).toHaveValue(
      '2',
    )
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${directory}/filter.png` })
  await page.keyboard.press('Escape')
  for (const theme of ['light', 'e-ink-light', 'e-ink-dark']) {
    await page.getByRole('button', { name: 'Open preferences menu', exact: true }).click()
    await page.locator(theme.endsWith('light') ? '#theme-btn-light' : '#theme-btn-dark').click()
    await page.locator(theme.startsWith('e-ink') ? '#eink-btn-on' : '#eink-btn-off').click()
    await page.keyboard.press('Escape')
    await expect(page.locator('.all-header-menu-dropdown')).toBeHidden()
    await expect(page.locator('.grid-app')).toHaveAttribute('data-theme', theme)
    await page.screenshot({ path: `${directory}/${theme}.png` })
  }
  await page.getByRole('button', { name: 'Open preferences menu', exact: true }).click()
  await page.locator('#eink-btn-off').click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.all-header-menu-dropdown')).toBeHidden()
  await expect(page.locator('.grid-app')).toHaveAttribute('data-theme', 'dark')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.screenshot({ path: `${directory}/mobile.png` })
  if (phase === 'after') {
    await page.screenshot({ path: `${directory}/mobile-more.png` })
    await expect(page.getByRole('button', { name: 'Save As', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Save As', exact: true }).scrollIntoViewIfNeeded()
    const saveAs = (await page.getByRole('button', { name: 'Save As', exact: true }).boundingBox())!
    expect(saveAs.x).toBeGreaterThanOrEqual(0)
    expect(saveAs.x + saveAs.width).toBeLessThanOrEqual(390)
    await page.keyboard.press('Escape')
    await page.getByRole('tab', { name: 'Home', exact: true }).click()
    await page.screenshot({ path: `${directory}/mobile-format.png` })
    await page.getByRole('button', { name: 'Clipboard', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Paste formulas', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Clipboard', exact: true })).toBeFocused()
    await page.getByRole('tab', { name: 'Table', exact: true }).click()
    await page.screenshot({ path: `${directory}/mobile-table.png` })
    await page.getByRole('button', { name: 'AutoFilter: Category', exact: true }).click()
    await page.screenshot({ path: `${directory}/mobile-filter.png` })
    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await (await gridCommand(page, 'Convert to Range')).click()
    await expect(page.locator('[data-cell-address="A1"]')).not.toHaveAttribute('data-table-role', 'header')
    await page.getByRole('grid').press('Escape')
    await expect(page.getByRole('tab', { name: 'Home', exact: true })).toBeFocused()
    await range.fill('A1:F12')
    await range.press('Enter')
    await (await gridCommand(page, 'Create Table')).click()
    await page.waitForTimeout(250)
    await page.screenshot({ path: `${directory}/mobile-create.png` })
    const bounds = (await page.getByRole('dialog').boundingBox())!
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.y).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(844)
    const previewRegion = page.getByRole('region', { name: 'Table preview', exact: true })
    await page.getByRole('dialog').getByRole('textbox', { name: 'Table name', exact: true }).focus()
    await page.keyboard.press('Tab')
    await expect(previewRegion).toBeFocused()
    await expect(previewRegion).toHaveCSS('outline-style', 'solid')
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => previewRegion.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    await page.screenshot({ path: `${directory}/mobile-preview-focus.png` })
    await page.keyboard.press('Escape')
    const phone = await page.context().newPage()
    await phone.setViewportSize({ width: 390, height: 844 })
    await phone.goto('./#/grid')
    await phone.locator('input[type="file"]').setInputFiles({
      name: 'Studio.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Item,Category\nBrand identity,Design\nLanding page,Design'),
    })
    await expect(phone.getByRole('dialog')).toBeVisible()
    await phone.waitForTimeout(250)
    await phone.screenshot({ path: `${directory}/mobile-import.png` })
    await phone.close()
    await page.setViewportSize({ width: 1440, height: 900 })
    await range.fill('A1')
    await range.press('Enter')
    await page.getByRole('tab', { name: 'Home', exact: true }).click()
    await page.getByRole('button', { name: 'Insert row above', exact: true }).click()
    await expect(page.locator('[data-cell-address="A2"]')).toHaveText('Item')
    await page.getByRole('grid').press('Control+z')
    await expect(page.locator('[data-cell-address="A1"]')).toHaveText('Item')
    await range.fill('A1')
    await range.press('Enter')
    await page.getByRole('button', { name: 'Insert column before', exact: true }).click()
    await expect(page.locator('[data-cell-address="B1"]')).toHaveText('Item')
    await page.getByRole('grid').press('Control+z')
    await expect(page.locator('[data-cell-address="A1"]')).toHaveText('Item')
  }
})
