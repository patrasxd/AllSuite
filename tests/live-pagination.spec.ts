import { expect, test, type Locator } from '@playwright/test'
import type { Editor } from '@tiptap/core'
import { mkdirSync } from 'node:fs'
import { generatedPNG } from './fixtures/png'

async function expectTextInsidePages(editor: Locator) {
  const violations = await editor.evaluate((element) => {
    const paper = element.closest('.draft-paper')!,
      css = getComputedStyle(paper)
    const scale = Number.parseFloat(getComputedStyle(paper.closest('.draft-page')!).zoom) || 1
    const pitch = Number.parseFloat(css.getPropertyValue('--draft-page-height')) + 24
    const body = Number.parseFloat(css.getPropertyValue('--draft-body-height'))
    const origin = element.getBoundingClientRect().top
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT),
      range = document.createRange()
    const errors: string[] = []
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim() || node.parentElement?.closest('[contenteditable="false"]')) continue
      range.selectNodeContents(node)
      for (const rect of range.getClientRects()) {
        if (!rect.width) continue
        const top = (rect.top - origin) / scale,
          bottom = (rect.bottom - origin) / scale
        const start = Math.floor((top + 1) / pitch) * pitch
        if (top - start < -2 || bottom - start > body + 2)
          errors.push(`${node.textContent.slice(0, 20)}: ${top}..${bottom} (body ${body})`)
      }
    }
    return errors.slice(0, 10)
  })
  expect(violations).toEqual([])
}

test('visible pages and live count split a long paragraph without changing document/history', async ({ page }) => {
  mkdirSync('docs/live-pagination-audit', { recursive: true })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('./#/draft')
  const editor = page.locator('.tiptap')
  await expect(editor).toBeVisible()
  await expect(page.locator('.draft-status-bar')).toContainText('Pages: 1')
  await editor.evaluate((element) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor
    editor.commands.setContent({
      type: 'doc',
      attrs: editor.getJSON().attrs,
      content: [
        {
          type: 'paragraph',
          content: Array.from({ length: 120 }, (_, i) => [
            ...(i ? [{ type: 'hardBreak' }] : []),
            { type: 'text', text: `Line ${i}: Zażółć gęślą jaźń.` },
          ]).flat(),
        },
      ],
    })
  })
  const before = await editor.evaluate((element) =>
    JSON.stringify((element as HTMLElement & { editor: Editor }).editor.getJSON()),
  )
  await expect(page.locator('.draft-sheet')).toHaveCount(3)
  await expect(page.locator('.draft-status-bar')).toContainText('Pages: 3')
  await page.waitForTimeout(100)
  await expectTextInsidePages(editor)
  expect(
    await editor.evaluate((element) => JSON.stringify((element as HTMLElement & { editor: Editor }).editor.getJSON())),
  ).toBe(before)
  await page.screenshot({ path: 'docs/live-pagination-audit/first-page.png' })
  await page.locator('.draft-document-area').evaluate((e) => e.scrollTo(0, 1000))
  await page.screenshot({ path: 'docs/live-pagination-audit/boundary.png' })
  expect(errors).toEqual([])
})

for (const fixture of ['wrapped paragraph', 'table', 'tall table row', 'rowspan table']) {
  test(`live pagination: ${fixture}`, async ({ page }) => {
    await page.goto('./#/draft')
    const editor = page.locator('.tiptap')
    await expect(editor).toBeVisible()
    await editor.evaluate((element, fixture) => {
      const editor = (element as HTMLElement & { editor: Editor }).editor
      const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
      const long = 'Natural wrapping Zażółć gęślą jaźń. '.repeat(700)
      const content =
        fixture === 'wrapped paragraph'
          ? [p(long)]
          : [
              {
                type: 'table',
                content: Array.from({ length: fixture === 'tall table row' ? 2 : 100 }, (_, row) => ({
                  type: 'tableRow',
                  attrs: { repeatHeader: row === 0 },
                  content: [
                    ...(fixture === 'rowspan table' && row === 2
                      ? []
                      : [
                          {
                            type: row ? 'tableCell' : 'tableHeader',
                            attrs: {
                              rowspan: fixture === 'rowspan table' && row === 1 ? 2 : 1,
                              colwidth: fixture === 'table' ? [120] : null,
                            },
                            content: [p(fixture === 'tall table row' && row ? long : `Cell ${row}`)],
                          },
                        ]),
                    {
                      type: row ? 'tableCell' : 'tableHeader',
                      attrs: { colwidth: fixture === 'table' ? [400] : null },
                      content: [p(`Value ${row}`)],
                    },
                  ],
                })),
              },
            ]
      editor.commands.setContent({ type: 'doc', attrs: editor.getJSON().attrs, content })
    }, fixture)
    await expect.poll(() => page.locator('.draft-sheet').count()).toBeGreaterThan(1)
    await page.waitForTimeout(150)
    await expectTextInsidePages(editor)
    if (fixture === 'table') {
      await expect(page.locator('.draft-pagination-repeat-header')).not.toHaveCount(0)
      const original = await editor
        .locator('.tableWrapper > table > tbody > tr')
        .first()
        .locator('th')
        .first()
        .boundingBox()
      const repeated = await editor.locator('.draft-pagination-repeat-header th').first().boundingBox()
      expect(Math.abs(original!.width - repeated!.width)).toBeLessThan(1)
    }
  })
}

test('typing, manual breaks, undo and resizing preserve selection and source', async ({ page }) => {
  await page.goto('./#/draft')
  const editor = page.locator('.tiptap')
  await editor.fill('First page')
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Control+Enter')
  await page.keyboard.type('Second page')
  await expect(page.locator('.draft-sheet')).toHaveCount(2)
  await expectTextInsidePages(editor)
  await editor.evaluate((element) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor
    editor.commands.undo()
    editor.commands.undo()
  })
  await expect(page.locator('.draft-sheet')).toHaveCount(1)
  const before = await editor.evaluate((element) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor
    return { json: editor.getJSON(), selection: editor.state.selection.toJSON() }
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(100)
  expect(
    await editor.evaluate((element) => {
      const editor = (element as HTMLElement & { editor: Editor }).editor
      return { json: editor.getJSON(), selection: editor.state.selection.toJSON() }
    }),
  ).toEqual(before)
  await expectTextInsidePages(editor)
  await editor.evaluate((element) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] })
  })
  await expect(page.locator('.draft-sheet')).toHaveCount(1)
  await expect(page.locator('.draft-status-bar')).toContainText('Pages: 1')
})

test('images fit sheets and headers/counters follow page setup without dirtying a clean view', async ({ page }) => {
  await page.goto('./#/draft')
  const editor = page.locator('.tiptap')
  await expect(editor).toBeVisible()
  await expect(page.locator('.draft-status-bar')).not.toContainText('Unsaved changes')
  await page.setViewportSize({ width: 820, height: 1180 })
  await page.waitForTimeout(100)
  await expect(page.locator('.draft-status-bar')).not.toContainText('Unsaved changes')
  await editor.evaluate(
    (element, png) => {
      const editor = (element as HTMLElement & { editor: Editor }).editor,
        attrs = { ...editor.state.doc.attrs }
      const setup = JSON.parse(attrs.pageSetup)
      attrs.pageSetup = JSON.stringify({
        ...setup,
        pageNumbers: true,
        headerText: 'Synthetic header',
        footerText: 'Synthetic footer',
      })
      editor.commands.setContent({
        type: 'doc',
        attrs,
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Before image. '.repeat(140) }] },
          {
            type: 'paragraph',
            content: [
              {
                type: 'image',
                attrs: { src: `data:image/png;base64,${png}`, width: 300, height: 1800, alt: 'Tall synthetic image' },
              },
            ],
          },
          { type: 'paragraph', content: [{ type: 'text', text: 'After image.' }] },
        ],
      })
      editor.view.dispatch(editor.state.tr.setDocAttribute('pageSetup', attrs.pageSetup))
    },
    Buffer.from(generatedPNG(60, 360)).toString('base64'),
  )
  await expect.poll(() => page.locator('.draft-sheet').count()).toBeGreaterThan(1)
  await page.waitForTimeout(200)
  await expectTextInsidePages(editor)
  const image = await page.locator('.draft-image img').boundingBox()
  expect(image!.height).toBeLessThan(970)
  await expect(page.locator('.draft-page-band--top').first()).toHaveText('Synthetic header')
  await expect(page.locator('.draft-page-band--bottom').first()).toContainText('1 /')
})

test('multiple columns retain continuous view with an explicit explanation', async ({ page }) => {
  await page.goto('./#/draft')
  const editor = page.locator('.tiptap')
  await editor.fill('Preserve column layout')
  await page.getByRole('tab', { name: 'Layout', exact: true }).click()
  await page.getByRole('combobox', { name: 'Columns', exact: true }).selectOption('2')
  await expect(page.getByRole('note')).toContainText('Multiple columns use continuous editing')
  await expect(page.locator('.draft-sheet')).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Columns', exact: true }).selectOption('1')
  await expect(page.locator('.draft-sheet')).toHaveCount(1)
  await expect(editor).toHaveText('Preserve column layout')
})

test('typing over the page edge keeps the caret visible and undo removes the extra page', async ({ page }) => {
  await page.goto('./#/draft')
  const editor = page.locator('.tiptap')
  await expect(editor).toBeVisible()
  await editor.evaluate((element) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: Array.from({ length: 40 }, (_, i) => [
            ...(i ? [{ type: 'hardBreak' }] : []),
            { type: 'text', text: `Line ${i}` },
          ]).flat(),
        },
      ],
    })
    editor.commands.focus('end')
  })
  await expect(page.locator('.draft-sheet')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Next page')
  await expect(page.locator('.draft-sheet')).toHaveCount(2)
  await expectTextInsidePages(editor)
  const visible = await editor.evaluate((element) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor
    const caret = editor.view.coordsAtPos(editor.state.selection.head),
      pane = element.closest('.draft-document-area')!.getBoundingClientRect()
    return caret.top >= pane.top && caret.bottom <= pane.bottom
  })
  expect(visible).toBe(true)
  await editor.evaluate((element) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor
    editor.commands.undo()
  })
  await expect(page.locator('.draft-sheet')).toHaveCount(1)
})

test('composition defers page decoration changes until composition ends', async ({ page }) => {
  await page.goto('./#/draft')
  const editor = page.locator('.tiptap')
  await editor.fill('Start')
  await editor.dispatchEvent('compositionstart', { data: '' })
  await editor.evaluate((element) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor
    editor.commands.insertContent('Composition text. '.repeat(2000))
  })
  await page.waitForTimeout(100)
  await expect(page.locator('.draft-sheet')).toHaveCount(1)
  await editor.dispatchEvent('compositionend', { data: 'text' })
  await expect.poll(() => page.locator('.draft-sheet').count()).toBeGreaterThan(1)
  await expectTextInsidePages(editor)
})
