import { gridCommand } from './helpers/grid-command'
import { expect, test } from '@playwright/test'

test('@smoke Grid shares a cancellable draft between editors and commits real multiline input as one undo step', async ({
  page,
}) => {
  await page.goto('./#/grid')
  const grid = page.getByRole('grid')
  const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
  await formulaBar.fill('pending')
  await formulaBar.press('F2')
  const editor = page.getByRole('textbox', { name: 'Edit cell A1' })
  await expect(editor).toBeFocused()
  await expect(editor).toHaveValue('pending')
  await formulaBar.click()
  await expect(formulaBar).toHaveValue('pending')
  await formulaBar.press('Escape')
  await expect(grid).toBeFocused()
  await expect(page.getByRole('button', { name: 'Undo (Ctrl+Z or ⌘Z)' })).toBeDisabled()

  await page.locator('[data-cell-address="A1"]').dblclick()
  await editor.fill('first')
  await editor.press('Alt+Enter')
  await editor.pressSequentially('second')
  await expect(editor).toHaveValue('first\nsecond')
  await formulaBar.click()
  await expect(formulaBar).toHaveValue('first\nsecond')
  await formulaBar.press('Tab')
  await expect(page.getByRole('textbox', { name: 'Name box' })).toHaveValue('B1')
  await expect(grid).toHaveAttribute('aria-activedescendant', 'grid-cell-B1')
  await expect(page.locator('[data-cell-address="A1"]')).toContainText('first\nsecond')
  await grid.press('Control+z')
  await expect(page.locator('[data-cell-address="A1"]')).toHaveAttribute('aria-label', 'A1, empty')
  await grid.press('Control+y')
  await expect(page.locator('[data-cell-address="A1"]')).toContainText('first\nsecond')
})

test('@smoke Grid mobile editing retains literal input through sheet changes and confirms New', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })
  try {
    const page = await context.newPage()
    await page.goto('http://127.0.0.1:4176/AllSuite/#/grid')
    const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
    await formulaBar.tap()
    await formulaBar.fill("'=literal")
    await formulaBar.press('F2')
    const editor = page.getByRole('textbox', { name: 'Edit cell A1' })
    await expect(editor).toBeFocused()
    await expect(editor).toHaveAttribute('inputmode', 'text')
    await expect(editor).toHaveValue("'=literal")
    await page.getByRole('button', { name: 'Add sheet' }).tap()
    await page.getByRole('tab', { name: 'Sheet1', exact: true }).tap()
    await expect(page.getByRole('gridcell', { name: 'A1, =literal' })).toBeVisible()
    await formulaBar.tap()
    await expect(formulaBar).toHaveValue("'=literal")
    await formulaBar.press('Escape')
    await expect(page.getByRole('grid')).toBeFocused()
    await page.getByRole('button', { name: 'File', exact: true }).tap()
    page.once('dialog', (dialog) => dialog.dismiss())
    await (await gridCommand(page, 'New')).tap()
    await expect(page.getByRole('gridcell', { name: 'A1, =literal' })).toBeVisible()
    page.once('dialog', (dialog) => dialog.accept())
    await (await gridCommand(page, 'New')).tap()
    await expect(page.getByRole('gridcell', { name: 'A1, empty' })).toBeVisible()
    await expect(page.getByRole('grid')).toBeFocused()
    await page.getByRole('tab', { name: 'Home', exact: true }).tap()
    await expect(page.getByRole('button', { name: 'Undo (Ctrl+Z or ⌘Z)' })).toBeDisabled()
  } finally {
    await context.close()
  }
})
