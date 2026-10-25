import { expect, test } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'

for (const app of ['grid', 'draft'] as const) {
  for (const mobile of [false, true]) {
    test(`${app} shared ${mobile ? 'mobile' : 'desktop'} actions undo, redo and save the current edit`, async ({
      page,
    }) => {
      await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 })
      await page.addInitScript(
        (extension) => {
          Object.assign(window, { chromeWritten: [] as number[] })
          Object.defineProperty(window, 'showSaveFilePicker', {
            configurable: true,
            value: async () => ({
              kind: 'file',
              name: `shared-shell.${extension}`,
              createWritable: async () => ({
                write: async (blob: Blob) =>
                  Object.assign(window, { chromeWritten: Array.from(new Uint8Array(await blob.arrayBuffer())) }),
                close: async () => {},
              }),
            }),
          })
        },
        app === 'grid' ? 'xlsx' : 'docx',
      )
      await page.goto(`./apps/${app}`)
      const input = page.getByRole('textbox', { name: app === 'grid' ? 'Formula bar' : 'Document editor', exact: true })
      await input.fill('Shared saved text')
      if (app === 'grid') await input.press('Control+Enter')
      const nav = page.locator('.allsuite-editor-navigation')
      const undo = nav.locator('button[aria-keyshortcuts="Control+Z Meta+Z"]')
      const redo = nav.locator('button[aria-keyshortcuts^="Control+Y"]')
      await expect(undo).toBeEnabled()
      if (mobile) {
        await undo.focus()
        await page.keyboard.press('Tab')
        // Redo is initially disabled, so the next focusable item is the active tab.
        await expect(nav.getByRole('tab', { selected: true })).toBeFocused()
      }
      await undo.click()
      if (app === 'grid') await expect(input).toHaveValue('')
      else await expect(input).toHaveText('')
      await redo.click()
      if (app === 'grid') await expect(input).toHaveValue('Shared saved text')
      else await expect(input).toHaveText('Shared saved text')
      // An in-progress spreadsheet draft must be included, not lost to header focus.
      await input.fill('Pending saved text')
      const save = page.locator(
        mobile
          ? '.allsuite-editor-header-actions .allsuite-editor-save'
          : '.allsuite-editor-navigation .allsuite-editor-save',
      )
      await save.click()
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { chromeWritten: number[] }).chromeWritten.length))
        .toBeGreaterThan(0)
      const bytes = await page.evaluate(() => (window as unknown as { chromeWritten: number[] }).chromeWritten)
      const parts = unzipSync(new Uint8Array(bytes))
      const text = Object.entries(parts)
        .filter(([name]) => name.endsWith('.xml'))
        .map(([, bytes]) => strFromU8(bytes))
        .join('\n')
      expect(text).toContain('Pending saved text')
      await expect(page.locator('.allsuite-editor-filename')).toContainText('shared-shell.')
      await expect(save).toBeEnabled()
    })
  }
}
