import { expect, test } from '@playwright/test'
import type { Editor } from '@tiptap/core'
import { mkdirSync, writeFileSync } from 'node:fs'

const evidence = 'docs/references-pagination-audit/views'
for (const theme of ['dark', 'light', 'e-ink-light', 'e-ink-dark'])
  for (const [width, height] of [
    [390, 844],
    [844, 390],
    [820, 1180],
    [1280, 800],
    [1920, 1080],
  ]) {
    test(`paginated references ${theme} ${width} EN/PL`, async ({ page }) => {
      mkdirSync(evidence, { recursive: true })
      await page.setViewportSize({ width, height })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.addInitScript((theme) => localStorage.setItem('allsuite:theme', theme), theme)
      await page.goto('./#/draft')
      const body = page.locator('.draft-paper .tiptap')
      await body.waitFor()
      await body.evaluate((element) => {
        const editor = (element as HTMLElement & { editor: Editor }).editor
        editor.commands.setContent({
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 1, anchorId: 'intro' },
              content: [{ type: 'text', text: 'Synthetic reference document' }],
            },
            { type: 'tableOfContents', attrs: { minLevel: 1, maxLevel: 3 }, content: [] },
            { type: 'tableOfContents', attrs: { captionLabel: 'Figure' }, content: [] },
            {
              type: 'paragraph',
              attrs: { anchorId: 'figure', captionLabel: 'Figure' },
              content: [
                { type: 'captionNumber', attrs: { label: 'Figure', number: 1 } },
                { type: 'text', text: ': A synthetic caption — zażółć gęślą jaźń' },
              ],
            },
            ...Array.from({ length: 80 }, (_, i) => ({
              type: 'paragraph',
              content: [
                { type: 'text', text: `Paragraph ${i}. Synthetic text exercises internal document scrolling.` },
              ],
            })),
            {
              type: 'heading',
              attrs: { level: 2, anchorId: 'conclusion' },
              content: [{ type: 'text', text: 'Conclusion' }],
            },
          ],
        })
      })
      await page.getByRole('tab', { name: 'Insert', exact: true }).click()
      await page.getByRole('button', { name: 'References', exact: true }).click()
      await page.getByRole('button', { name: 'Update reference', exact: true }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(body.locator('.draft-toc-page').first()).toHaveText('1')
      await page.locator('.draft-document-area').evaluate((e) => e.scrollTo(0, 0))
      const capture = async (name: string) => {
        await page.screenshot({ path: `${evidence}/${name}-${theme}-${width}.png` })
        if (width === 390 || width === 1280)
          await expect(page).toHaveScreenshot(`paged-references-${name}-${theme}-${width}.png`)
      }
      await capture('pages')
      const metrics = await page.evaluate(() => ({
        outerWidth: document.documentElement.scrollWidth,
        outerScroll: document.scrollingElement!.scrollTop,
        toolbarTop: document.querySelector('.draft-tools')!.getBoundingClientRect().top,
        statusBottom: document.querySelector('.draft-status-bar')!.getBoundingClientRect().bottom,
        documentHeight: document.querySelector('.draft-document-area')!.clientHeight,
      }))
      expect(metrics.outerWidth).toBeLessThanOrEqual(width)
      expect(metrics.outerScroll).toBe(0)
      expect(metrics.toolbarTop).toBeGreaterThanOrEqual(0)
      expect(metrics.statusBottom).toBeLessThanOrEqual(height)
      expect(metrics.documentHeight).toBeGreaterThan(80)
      for (const locale of ['en', 'pl']) {
        if (locale === 'pl') {
          await page.evaluate(() => localStorage.setItem('allsuite:locale', 'pl'))
          await page.reload()
          await body.fill('Syntetyczny obiekt — zażółć')
          await page.getByRole('tab', { name: 'Wstawianie', exact: true }).click()
        }
        await page.getByRole('button', { name: locale === 'en' ? 'References' : 'Odwołania', exact: true }).click()
        const dialog = page.getByRole('dialog')
        await dialog
          .getByRole('combobox', { name: locale === 'en' ? 'Reference type' : 'Typ odwołania', exact: true })
          .selectOption('caption')
        await dialog
          .getByRole('textbox', { name: locale === 'en' ? 'Caption text' : 'Tekst podpisu', exact: true })
          .fill('A synthetic caption — zażółć gęślą jaźń')
        await capture(`caption-${locale}`)
        if (width < 1024 || height < 500)
          for (const control of await dialog.locator('button,input,select').all()) {
            expect(
              await control.evaluate((e) => Math.min((e as HTMLElement).offsetWidth, (e as HTMLElement).offsetHeight)),
            ).toBeGreaterThanOrEqual(44)
          }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
        await dialog.getByRole('button', { name: locale === 'en' ? 'Cancel' : 'Anuluj', exact: true }).click()
      }
      writeFileSync(
        `${evidence}/${theme}-${width}.json`,
        JSON.stringify({ theme, width, height, metrics }, null, 2) + '\n',
      )
    })
  }
