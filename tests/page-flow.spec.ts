import { expect, test } from '@playwright/test'
import type { Editor } from '@tiptap/core'

test('print/web view, physical presets, fit width and zoom preserve document and undo', async ({ page }) => {
  await page.goto('./#/draft')
  const editor = page.locator('.tiptap')
  await editor.fill('Synthetic view changes')
  const original = await editor.evaluate((e) =>
    JSON.stringify((e as HTMLElement & { editor: Editor }).editor.getJSON()),
  )
  await page.getByRole('tab', { name: 'View', exact: true }).click()
  await page.getByRole('combobox', { name: 'Document view', exact: true }).selectOption('web')
  await expect(page.locator('.draft-sheet')).toHaveCount(0)
  await expect(page.locator('.draft-page--web')).toBeVisible()
  await expect
    .poll(async () => {
      const ticks = page.locator('.draft-ruler-scale span')
      const first = await ticks.nth(0).boundingBox(),
        next = await ticks.nth(1).boundingBox()
      return Math.abs(next!.x - first!.x - 96)
    })
    .toBeLessThan(1)
  for (const value of ['50', '200', 'fit'])
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption(value)
  await page.getByRole('combobox', { name: 'Document view', exact: true }).selectOption('print')
  await expect(page.locator('.draft-sheet')).toHaveCount(1)
  const width = await page.locator('.draft-page').evaluate((e) => e.getBoundingClientRect().width)
  expect(width).toBeGreaterThan(1100)
  expect(await editor.evaluate((e) => JSON.stringify((e as HTMLElement & { editor: Editor }).editor.getJSON()))).toBe(
    original,
  )
  await page.getByRole('tab', { name: 'Layout', exact: true }).click()
  for (const size of ['a4', 'a5', 'letter', 'legal']) {
    await page.getByRole('combobox', { name: 'Paper size', exact: true }).selectOption(size)
    await expect(page.locator('.draft-page')).toHaveClass(new RegExp(`draft-page--${size}`))
  }
  await page.getByRole('button', { name: 'Page setup', exact: true }).click()
  await page.getByRole('textbox', { name: 'Header text', exact: true }).fill('Preset header')
  await page.getByRole('combobox', { name: 'Margin preset', exact: true }).selectOption('12.7')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  expect(
    await editor.evaluate(
      (e) => JSON.parse((e as HTMLElement & { editor: Editor }).editor.state.doc.attrs.pageSetup).left,
    ),
  ).toBe(720)
  expect(
    await editor.evaluate(
      (e) => JSON.parse((e as HTMLElement & { editor: Editor }).editor.state.doc.attrs.pageSetup).header,
    ),
  ).toBe(360)
})

for (const rule of ['keepLines', 'keepNext', 'widowControl'] as const)
  test(`paragraph page flow ${rule}`, async ({ page }) => {
    await page.goto('./#/draft')
    const editor = page.locator('.tiptap')
    await expect(editor).toBeVisible()
    const load = async (enabled: boolean) =>
      editor.evaluate(
        (element, { rule, enabled }) => {
          const editor = (element as HTMLElement & { editor: Editor }).editor
          const p = (length: number, label: string, attrs: Record<string, boolean> = {}) => ({
            type: 'paragraph',
            attrs: { spacingAfter: 0, ...attrs },
            content: Array.from({ length }, (_, i) => [
              ...(i ? [{ type: 'hardBreak' }] : []),
              { type: 'text', text: `${label}-${i}` },
            ]).flat(),
          })
          const content =
            rule === 'keepNext'
              ? [p(37, 'FILL'), p(2, 'TARGET', { keepNext: enabled }), p(3, 'NEXT')]
              : [p(39, 'FILL'), p(rule === 'keepLines' ? 4 : 5, 'TARGET', { widowControl: false, [rule]: enabled })]
          editor.commands.setContent({ type: 'doc', content })
        },
        { rule, enabled },
      )
    const targetPage = () =>
      editor.evaluate((element) => {
        const editor = (element as HTMLElement & { editor: Editor }).editor
        const scale = Number.parseFloat(getComputedStyle(element.closest('.draft-page')!).zoom) || 1
        let top = 0
        editor.state.doc.descendants((node, pos) => {
          if (node.isText && node.text?.startsWith('TARGET-0'))
            top = (editor.view.coordsAtPos(pos).top - element.getBoundingClientRect().top) / scale
        })
        return Math.floor((top + 1) / (16838 / 15 + 24)) + 1
      })
    await load(false)
    await expect(page.locator('.draft-sheet')).toHaveCount(2)
    await expect.poll(targetPage).toBe(1)
    await load(true)
    await expect.poll(targetPage).toBe(2)
    await expect(page.locator('.draft-status-bar')).toContainText('Pages: 2')
  })

test('current page follows caret and internal scrolling', async ({ page }) => {
  await page.goto('./#/draft')
  const editor = page.locator('.tiptap')
  await editor.fill('One')
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Control+Enter')
  await page.keyboard.type('Two')
  await expect(page.locator('.draft-status-bar')).toContainText('Current page: 2')
  await page.locator('.draft-document-area').evaluate((e) => e.scrollTo(0, 0))
  await expect(page.locator('.draft-status-bar')).toContainText('Current page: 1')
})

test('phone pinch zoom scales only the document and leaves the toolbar fixed', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./#/draft')
  await expect(page.locator('.tiptap')).toBeVisible()
  const pane = page.locator('.draft-document-area'),
    paper = page.locator('.draft-page')
  const initial = await paper.evaluate((e) => Number.parseFloat(getComputedStyle(e).zoom))
  const toolbar = await page.locator('.draft-tools').boundingBox()
  await expect(pane).toBeVisible()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 })
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: 100, y: 400, id: 0 },
      { x: 200, y: 400, id: 1 },
    ],
  })
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: 60, y: 400, id: 0 },
      { x: 240, y: 400, id: 1 },
    ],
  })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect
    .poll(() => paper.evaluate((e) => Number.parseFloat(getComputedStyle(e).zoom)))
    .toBeGreaterThan(initial * 1.7)
  expect(await page.locator('.draft-tools').boundingBox()).toEqual(toolbar)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1)
  await cdp.detach()
})
