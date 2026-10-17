import { expect, test } from '@playwright/test'
import type { Editor } from '@tiptap/core'
import { mkdirSync, writeFileSync } from 'node:fs'

for (const theme of ['dark', 'light', 'e-ink-light', 'e-ink-dark'])
  for (const [width, height] of [
    [390, 844],
    [844, 390],
    [820, 1180],
    [1280, 800],
    [1920, 1080],
  ])
    test(`read-only print preview ${theme} ${width} EN/PL`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.addInitScript((theme) => localStorage.setItem('allsuite:theme', theme), theme)
      for (const locale of ['en', 'pl']) {
        if (locale === 'pl') await page.evaluate(() => localStorage.setItem('allsuite:locale', 'pl'))
        await page.goto('./#/draft')
        if (locale === 'pl') await page.reload()
        const body = page.locator('.draft-paper .tiptap')
        await body.waitFor()
        await body.evaluate((element) => {
          const editor = (element as HTMLElement & { editor: Editor }).editor
          editor.commands.setContent({
            type: 'doc',
            content: [
              {
                type: 'heading',
                attrs: { level: 1 },
                content: [{ type: 'text', text: 'Synthetic print preview — zażółć' }],
              },
              ...Array.from({ length: 70 }, (_, i) => ({
                type: 'paragraph',
                content: [{ type: 'text', text: `Paragraph ${i}. Read-only pages retain the editor pagination.` }],
              })),
            ],
          })
          editor.commands.setTextSelection(3)
        })
        await expect.poll(() => page.locator('.draft-sheet').count()).toBeGreaterThan(1)
        const count = await page.locator('.draft-sheet').count(),
          before = await body.evaluate((element) => {
            const editor = (element as HTMLElement & { editor: Editor }).editor
            return { json: JSON.stringify(editor.getJSON()), caret: editor.state.selection.from }
          })
        await page.getByRole('tab', { name: locale === 'en' ? 'View' : 'Widok', exact: true }).click()
        if (!(await body.locator('.draft-format-paragraph').count()))
          await page
            .getByRole('button', {
              name: locale === 'en' ? 'Show formatting marks' : 'Pokaż znaki formatowania',
              exact: true,
            })
            .click()
        await expect(body.locator('.draft-format-paragraph').first()).toBeVisible()
        await page.getByRole('tab', { name: locale === 'en' ? 'File' : 'Plik', exact: true }).click()
        const preview = locale === 'en' ? 'Print preview' : 'Podgląd wydruku'
        await page.getByRole('button', { name: preview, exact: true }).click()
        const frame = page.frameLocator(`iframe[title="${preview}"]`)
        await expect(frame.locator('.print-sheet')).toHaveCount(count)
        await expect(frame.locator('[contenteditable],.draft-format-paragraph,.draft-ruler,button')).toHaveCount(0)
        const toolbar = page.getByRole('toolbar', { name: preview, exact: true })
        for (const control of await toolbar.locator('button,select').all())
          expect(
            await control.evaluate((e) => Math.min((e as HTMLElement).offsetWidth, (e as HTMLElement).offsetHeight)),
          ).toBeGreaterThanOrEqual(44)
        const metrics = await page.evaluate(() => ({
          outerWidth: document.documentElement.scrollWidth,
          outerScroll: document.scrollingElement!.scrollTop,
          toolbarTop: document.querySelector('.draft-preview-tools')!.getBoundingClientRect().top,
          previewHeight: document.querySelector('.draft-preview-pages')!.clientHeight,
        }))
        expect(metrics.outerWidth).toBeLessThanOrEqual(width)
        expect(metrics.outerScroll).toBe(0)
        expect(metrics.toolbarTop).toBeGreaterThanOrEqual(0)
        expect(metrics.previewHeight).toBeGreaterThan(80)
        mkdirSync('docs/print-pdf-audit/views', { recursive: true })
        await page.screenshot({ path: `docs/print-pdf-audit/views/${locale}-${theme}-${width}.png` })
        if (width === 390 || width === 1280)
          await expect(page).toHaveScreenshot(`print-preview-${locale}-${theme}-${width}.png`)
        writeFileSync(
          `docs/print-pdf-audit/views/${locale}-${theme}-${width}.json`,
          JSON.stringify({ theme, locale, width, height, pages: count, metrics }, null, 2) + '\n',
        )
        await page
          .getByRole('button', { name: locale === 'en' ? 'Back to editor' : 'Wróć do edytora', exact: true })
          .click()
        await expect(body).toBeEditable()
        expect(
          await body.evaluate((element) => {
            const editor = (element as HTMLElement & { editor: Editor }).editor
            return { json: JSON.stringify(editor.getJSON()), caret: editor.state.selection.from }
          }),
        ).toEqual(before)
      }
    })
