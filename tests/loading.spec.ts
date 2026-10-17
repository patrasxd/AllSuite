import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

test.use({ serviceWorkers: 'block' })

for (const theme of ['dark', 'light', 'e-ink-light', 'e-ink-dark']) {
  for (const width of [390, 1280]) {
    test(`refresh preserves the shared shell without loading screens ${theme} ${width}`, async ({ page }) => {
      const locale = width === 390 ? 'pl' : 'en'
      await page.setViewportSize({ width, height: width === 390 ? 844 : 800 })
      await page.addInitScript(
        ({ theme, locale }) => {
          localStorage.setItem('allsuite:theme', theme)
          localStorage.setItem('allsuite:locale', locale)
        },
        { theme, locale },
      )
      const report = JSON.parse(readFileSync('apps/shell/dist/bundle-report.json', 'utf8')) as Array<{
        entry: boolean
        dynamicImports: string[]
      }>
      const appChunk = report.find((chunk) => chunk.entry)!.dynamicImports[0]
      let releaseApp!: () => void, releaseEditor!: () => void
      const appReady = new Promise<void>((resolve) => {
        releaseApp = resolve
      })
      const editorReady = new Promise<void>((resolve) => {
        releaseEditor = resolve
      })
      let appBlocked = false,
        editorBlocked = false
      await page.route(`**/${appChunk}`, async (route) => {
        appBlocked = true
        await appReady
        await route.continue()
      })
      await page.route(/\/assets\/DocumentWorkspace-[^/]+\.js$/, async (route) => {
        editorBlocked = true
        await editorReady
        await route.continue()
      })
      await page.goto('./#/draft', { waitUntil: 'domcontentloaded' })
      await expect.poll(() => appBlocked).toBe(true)
      const back = page.getByRole('button', { name: locale === 'pl' ? 'Wróć do AllSuite' : 'Back to AllSuite' })
      await expect(back).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expect(page.locator('.suite-workspace')).toBeEmpty()
      await page.screenshot({ path: `test-results/startup-shell-${theme}-${width}.png` })
      releaseApp()
      await expect.poll(() => editorBlocked).toBe(true)
      await expect(back).toBeVisible()
      await expect(page.locator('.draft-app')).toBeEmpty()
      await expect(page.getByText(/Opening your workspace|Opening the editor|Otwieranie edytora/)).toHaveCount(0)
      await page.screenshot({ path: `test-results/startup-editor-${theme}-${width}.png` })
      releaseEditor()
      await expect(page.locator('.tiptap')).toBeVisible()
      await page.reload()
      await expect(page.locator('.tiptap')).toBeVisible()
      await expect(page.getByText(/Opening your workspace|Opening the editor|Otwieranie edytora/)).toHaveCount(0)
    })
  }
}
