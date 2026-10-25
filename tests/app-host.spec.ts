import { expect, test } from '@playwright/test'

for (const firstApp of ['draft', 'grid'] as const) {
  test(`host preferences, header and dirty guard survive ${firstApp} to other app`, async ({ page }) => {
    await page.goto('./')
    await page.getByRole('button', { name: `Open ${firstApp === 'draft' ? 'Draft' : 'Grid'}`, exact: true }).click()
    const order = firstApp === 'draft' ? ['draft', 'grid'] : ['grid', 'draft']
    for (const app of order) {
      const root = page.locator(`.${app}-app`)
      await expect(root).toBeVisible()
      await page.getByRole('button', { name: 'Open preferences menu', exact: true }).click()
      await page.getByRole('button', { name: 'Light', exact: true }).click()
      await page.getByRole('button', { name: 'On', exact: true }).click()
      await page.getByRole('button', { name: 'Polski', exact: true }).click()
      await expect(root).toHaveAttribute('data-eink', 'true')
      await expect(root).toHaveAttribute('data-theme', 'e-ink-light')
      await expect(page.getByRole('button', { name: 'Plik', exact: true })).toBeVisible()
      // Return to English through the real host UI, without remounting the app.
      await page.getByRole('button', { name: 'English', exact: true }).click()
      await page.locator('#header-menu-toggle').click()
      const stats = page.locator('.allsuite-editor-header-content')
      if (app === 'draft') {
        await expect(stats).toBeVisible()
        await page.getByRole('textbox', { name: 'Document editor', exact: true }).fill('Host contract')
        await expect(stats).toContainText('Untitled')
        await expect(page.locator('.all-workspace-status')).toContainText('Words: 2')
        await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible()
      } else {
        // Both apps supply the same shared header contribution.
        await expect(stats).toContainText('Book1')
        await page.locator('[data-cell-address="A1"]').dblclick()
        await page.getByRole('textbox', { name: 'Edit cell A1', exact: true }).fill('Host contract')
        // An uncommitted cell draft must already protect shell navigation.
        await expect(root).toHaveAttribute('data-dirty', 'true')
      }
      await page.getByRole('button', { name: 'Back to AllSuite', exact: true }).click()
      const guard = page.getByRole('dialog', { name: 'Unsaved changes', exact: true })
      await expect(guard).toBeVisible()
      await guard.getByRole('button', { name: 'Stay', exact: true }).click()
      await expect(root).toBeVisible()
      if (app === 'draft') {
        await expect(page.getByRole('textbox', { name: 'Document editor', exact: true })).toHaveText('Host contract')
      } else {
        // Moving focus to the shell commits the draft through Grid's existing blur handler.
        await expect(page.locator('[data-cell-address="A1"]')).toHaveText('Host contract')
        await expect(page.getByRole('textbox', { name: 'Formula bar', exact: true })).toHaveValue('Host contract')
        await expect(root).toHaveAttribute('data-dirty', 'true')
      }
      await page.getByRole('button', { name: 'Back to AllSuite', exact: true }).click()
      await guard.getByRole('button', { name: 'Leave without saving', exact: true }).click()
      await expect(page.locator('.home-page')).toBeVisible()
      await expect(stats).toHaveCount(0)
      if (app === order[0]) {
        const next = order[1]
        await page.getByRole('button', { name: `Open ${next === 'draft' ? 'Draft' : 'Grid'}`, exact: true }).click()
        // A new app session starts clean and receives the current host preference.
        await expect(page.locator(`.${next}-app`)).toHaveAttribute('data-eink', 'true')
      }
    }
  })
}
