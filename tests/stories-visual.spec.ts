import { test, expect } from '@playwright/test'
import type { Editor } from '@tiptap/core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { generatedPNG } from './fixtures/png'

const evidence = 'docs/stories-audit/views'
for (const theme of ['dark', 'light', 'e-ink-light', 'e-ink-dark'])
  for (const [width, height] of [
    [390, 844],
    [844, 390],
    [820, 1180],
    [1280, 800],
    [1920, 1080],
  ]) {
    test(`rich stories ${theme} ${width} EN/PL`, async ({ page }) => {
      mkdirSync(evidence, { recursive: true })
      await page.setViewportSize({ width, height })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.addInitScript((theme) => localStorage.setItem('allsuite:theme', theme), theme)
      await page.goto('./#/draft')
      const body = page.locator('.draft-paper .tiptap')
      await body.fill('Synthetic text')
      await body.evaluate(
        (element, png) => {
          const editor = (element as HTMLElement & { editor: Editor }).editor
          const header = (text: string) => [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text,
                  marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { color: '#005577', fontFamily: 'Tinos' } }],
                },
                { type: 'storyField', attrs: { field: 'TITLE' } },
              ],
            },
            {
              type: 'paragraph',
              content: [
                {
                  type: 'image',
                  attrs: { src: `data:image/png;base64,${png}`, width: 80, height: 40, alt: 'Synthetic logo' },
                },
              ],
            },
          ]
          const footer = [
            {
              type: 'paragraph',
              attrs: { textAlign: 'right' },
              content: [
                { type: 'text', text: 'Page ' },
                { type: 'storyField', attrs: { field: 'PAGE' } },
                { type: 'text', text: ' / ' },
                { type: 'storyField', attrs: { field: 'NUMPAGES' } },
              ],
            },
          ]
          const setup = JSON.parse(editor.state.doc.attrs.pageSetup)
          setup.stories = {
            differentFirst: true,
            differentEven: true,
            start: 7,
            format: 'lowerRoman',
            title: 'Zażółć gęślą jaźń',
            header: { default: header('ODD · '), first: header('FIRST · '), even: header('EVEN · ') },
            footer: { default: footer, first: footer, even: footer },
          }
          editor.commands.setContent({
            type: 'doc',
            content: Array.from({ length: 90 }, (_, i) => ({
              type: 'paragraph',
              content: [{ type: 'text', text: `Synthetic paragraph ${i}. No private content.` }],
            })),
          })
          editor.view.dispatch(editor.state.tr.setDocAttribute('pageSetup', JSON.stringify(setup)))
        },
        Buffer.from(generatedPNG(160, 80)).toString('base64'),
      )
      await page.evaluate(() => document.fonts.ready)
      await expect.poll(() => page.locator('.draft-sheet').count()).toBeGreaterThan(2)
      await expect(page.locator('.draft-page-band--top').first()).toContainText('FIRST')
      await expect(page.locator('.draft-page-band--top').nth(1)).toContainText('EVEN')
      await page.getByRole('tab', { name: 'Layout', exact: true }).click()
      await page.locator('.draft-document-area').evaluate((element) => element.scrollTo(0, 0))
      const metrics = await page.evaluate(() => {
        const toolbar = document.querySelector('.draft-tools')!.getBoundingClientRect()
        const status = document.querySelector('.draft-status-bar')!.getBoundingClientRect()
        const header = document.querySelector('.draft-page-band--top .draft-story-content')!.getBoundingClientRect()
        const body = document.querySelector('.draft-paper .tiptap')!.getBoundingClientRect()
        const target = document.querySelector('.draft-story-region') as HTMLElement
        return {
          outerWidth: document.documentElement.scrollWidth,
          outerScroll: document.scrollingElement!.scrollTop,
          toolbarTop: toolbar.top,
          statusBottom: status.bottom,
          overlap: header.bottom - body.top,
          targetWidth: target.offsetWidth,
          targetHeight: target.offsetHeight,
        }
      })
      expect(metrics.outerWidth).toBeLessThanOrEqual(width)
      expect(metrics.outerScroll).toBe(0)
      expect(metrics.toolbarTop).toBeGreaterThanOrEqual(0)
      expect(metrics.statusBottom).toBeLessThanOrEqual(height)
      expect(metrics.overlap).toBeLessThanOrEqual(1)
      expect(metrics.targetWidth).toBeGreaterThanOrEqual(44)
      expect(metrics.targetHeight).toBeGreaterThanOrEqual(44)
      const capture = async (name: string) => {
        await page.screenshot({ path: `${evidence}/${name}-${theme}-${width}.png` })
        if (width === 390 || width === 1280)
          await expect(page).toHaveScreenshot(`stories-${name}-${theme}-${width}.png`)
      }
      await capture('sheets')
      for (const locale of ['en', 'pl']) {
        if (locale === 'pl') {
          // Preference changes are allowed; reload only this synthetic test fixture, with no unsaved user data.
          await page.evaluate(() => localStorage.setItem('allsuite:locale', 'pl'))
          await page.reload()
          await body.fill('Syntetyczna treść')
          await page.getByRole('tab', { name: 'Układ', exact: true }).click()
          await page.getByRole('button', { name: 'Ustawienia strony', exact: true }).click()
          await page.getByRole('button', { name: 'Edytuj nagłówki i stopki', exact: true }).click()
        } else await page.getByRole('button', { name: 'Edit rich headers and footers — Header 1', exact: true }).click()
        const dialog = page.getByRole('dialog')
        if (locale === 'pl') await dialog.locator('.tiptap').fill('Nagłówek — zażółć')
        await dialog.locator('.draft-story-editor').scrollIntoViewIfNeeded()
        await capture(`dialog-${locale}`)
        const tools = dialog.locator('.draft-story-tools button')
        for (const button of await tools.all())
          expect(
            await button.evaluate((e) => Math.min((e as HTMLElement).offsetWidth, (e as HTMLElement).offsetHeight)),
          ).toBeGreaterThanOrEqual(44)
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
        await dialog.getByRole('button', { name: locale === 'pl' ? 'Anuluj' : 'Cancel', exact: true }).click()
      }
      writeFileSync(
        `${evidence}/${theme}-${width}.json`,
        JSON.stringify({ width, height, theme, metrics }, null, 2) + '\n',
      )
    })
  }
