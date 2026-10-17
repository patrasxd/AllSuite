import { expect, test } from '@playwright/test'

async function makeTwoHeadings(page: import('@playwright/test').Page) {
  await page.goto('./#/draft')
  const editor = page.getByRole('textbox', { name: 'Document editor', exact: true })
  await editor.fill('Alpha')
  await editor.press('Control+Alt+1')
  await editor.press('End')
  await editor.press('Enter')
  await editor.pressSequentially('Beta')
  await editor.press('Control+Alt+1')
  return editor
}

test('outline reorders headings with keyboard controls and drag and drop', async ({ page }) => {
  const editor = await makeTwoHeadings(page)
  await page.getByRole('tab', { name: 'View', exact: true }).click()
  await page.getByRole('button', { name: 'Outline', exact: true }).click()
  await expect(page.getByRole('tree', { name: 'Outline' })).toBeVisible()

  const moveBetaUp = page.getByRole('button', { name: 'Move up Beta' })
  await moveBetaUp.click()
  await expect(editor.locator('h1')).toHaveText(['Beta', 'Alpha'])
  const moveBetaDown = page.getByRole('button', { name: 'Move down Beta' })
  await expect(moveBetaDown).toBeFocused()
  await moveBetaDown.click()
  await expect(editor.locator('h1')).toHaveText(['Alpha', 'Beta'])
  await expect(page.getByRole('button', { name: 'Move up Beta' })).toBeFocused()

  const items = page.getByRole('treeitem')
  await items.nth(1).dragTo(items.nth(0))
  await expect(editor.locator('h1')).toHaveText(['Beta', 'Alpha'])
})

test('focus mode keeps the document and exits with Escape or the visible button', async ({ page }) => {
  const editor = await makeTwoHeadings(page)
  await page.getByRole('tab', { name: 'View', exact: true }).click()
  await page.getByRole('button', { name: 'Focus mode', exact: true }).click()
  await expect(editor).toBeVisible()
  await expect(page.getByRole('button', { name: 'Exit focus mode', exact: true })).toBeVisible()
  await expect(page.getByRole('tab')).toHaveCount(0)

  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Exit focus mode', exact: true })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'View', exact: true })).toBeVisible()

  await page.getByRole('tab', { name: 'View', exact: true }).click()
  await page.getByRole('button', { name: 'Focus mode', exact: true }).click()
  await page.getByRole('button', { name: 'Exit focus mode', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'View', exact: true })).toBeVisible()
})
