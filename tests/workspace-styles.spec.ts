import { expect, test } from '@playwright/test'

for (const apps of [
  ['draft', 'grid'],
  ['grid', 'draft'],
]) {
  test(`editor styles survive lazy navigation ${apps.join(' to ')}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('./')
    for (const app of apps) {
      await page.getByRole('button', { name: `Open ${app === 'draft' ? 'Draft' : 'Grid'}`, exact: true }).click()
      const canvas = page.locator(`.${app}-workspace > .all-fullbleed-layout__canvas-area`)
      await expect(canvas).toBeVisible()
      const toolbar = page.locator(`.${app}-toolbar:visible`)
      const group = toolbar.locator('.all-toolbar-group:visible').first()
      const controls = group.locator('.all-toolbar-group__controls')
      const caption = group.locator('.all-toolbar-group__caption')
      // App tools stay above the editing region, and their labels retain the product treatment.
      await expect(canvas).toHaveCSS('flex-direction', 'column')
      await expect(canvas).toHaveCSS('align-items', 'stretch')
      await expect(controls).toHaveCSS('justify-content', 'flex-start')
      await expect(caption).toHaveCSS('text-transform', 'uppercase')
      const surfaces = await group.evaluate((element) => ({
        group: getComputedStyle(element).backgroundColor,
        toolbar: getComputedStyle(element.closest('[role="toolbar"]')!).backgroundColor,
      }))
      if (app === 'grid') {
        // The approved Grid ribbon already uses --all-surface-2 cards.
        // Before-change evidence: docs/design/draft-ux/current-metrics.json.
        expect(surfaces.group).toBe('rgb(24, 24, 24)')
        expect(surfaces.toolbar).toBe('rgba(0, 0, 0, 0)')
      } else expect(surfaces.group).not.toBe(surfaces.toolbar)
      const file = page.getByRole('button', { name: 'File', exact: true })
      await page.getByRole('tab', { name: app === 'grid' ? 'Home' : 'Home', exact: true }).focus()
      await page.keyboard.press('Home')
      await expect(page.getByRole('tab', { name: 'Home', exact: true })).toBeFocused()
      await file.focus()
      await file.press('Enter')
      await expect(file).toHaveAttribute('aria-expanded', 'true')
      await expect(page.getByRole('button', { name: 'New', exact: true })).toBeFocused()
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Back to AllSuite', exact: true }).click()
    }
  })
}
