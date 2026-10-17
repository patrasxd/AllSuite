import { expect, test, type Page } from '@playwright/test'
import type { Editor } from '@tiptap/core'
import { strFromU8, unzipSync } from 'fflate'
import { generatedPNG } from './fixtures/png'
import { mkdirSync, writeFileSync } from 'node:fs'

test('100 pages with captions and fields retain the typing budget', async ({ page, context }) => {
  test.setTimeout(60000)
  await page.goto('./#/draft')
  const body = page.locator('.draft-paper .tiptap')
  await body.waitFor()
  await body.evaluate((element) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor
    editor.commands.setContent({
      type: 'doc',
      content: [
        { type: 'tableOfContents', attrs: { minLevel: 1, maxLevel: 1 }, content: [] },
        ...Array.from({ length: 100 }, (_, i) => [
          {
            type: 'heading',
            attrs: { level: i ? 2 : 1, anchorId: `heading_${i}`, pageBreakBefore: i ? 1 : null },
            content: [{ type: 'text', text: `Page ${i + 1}` }],
          },
          {
            type: 'paragraph',
            attrs: { anchorId: `caption_${i}`, captionLabel: 'Figure' },
            content: [
              { type: 'captionNumber', attrs: { label: 'Figure' } },
              { type: 'text', text: ': Synthetic figure' },
            ],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'crossReference', attrs: { targetId: `caption_${i}`, format: 'page', label: '?' } },
              { type: 'text', text: ' Editable text' },
            ],
          },
        ]).flat(),
      ],
    })
  })
  await expect(page.locator('.draft-sheet')).toHaveCount(100)
  const cdp = await context.newCDPSession(page)
  await cdp.send('HeapProfiler.collectGarbage')
  const before = await cdp.send('Runtime.getHeapUsage')
  const start = Date.now()
  await update(page)
  const updateMs = Date.now() - start
  await expect(body.locator('[data-draft-ref="caption_99"]')).toHaveText('100')
  await cdp.send('HeapProfiler.collectGarbage')
  const afterUpdate = await cdp.send('Runtime.getHeapUsage')
  const positions = []
  for (const fraction of [0, 0.5, 0.99]) {
    await body.evaluate((element, fraction) => {
      const editor = (element as HTMLElement & { editor: Editor }).editor
      const positions: number[] = []
      editor.state.doc.descendants((node, pos) => {
        if (node.isTextblock && node.type.name === 'paragraph' && !node.attrs.captionLabel)
          positions.push(pos + node.content.size + 1)
      })
      editor.commands.setTextSelection(positions[Math.floor((positions.length - 1) * fraction)])
      editor.chain().focus().scrollIntoView().run()
    }, fraction)
    const sync = [],
      frames = []
    for (let i = 0; i < 25; i++) {
      const sample = await body.evaluate(async (element) => {
        const editor = (element as HTMLElement & { editor: Editor }).editor
        const start = performance.now()
        editor.commands.insertContent('x')
        element.getBoundingClientRect()
        const sync = performance.now() - start
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        return { sync, frame: performance.now() - start }
      })
      if (i >= 5) {
        sync.push(sample.sync)
        frames.push(sample.frame)
      }
    }
    const p95 = (values: number[]) => values.sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]
    positions.push({ fraction, syncP95: p95(sync), doubleFrameP95: p95(frames) })
  }
  await cdp.send('HeapProfiler.collectGarbage')
  mkdirSync('docs/references-pagination-audit', { recursive: true })
  writeFileSync(
    'docs/references-pagination-audit/performance.json',
    JSON.stringify(
      {
        browser: context.browser()?.version(),
        pages: 100,
        updateMs,
        budget: 'sync p95 < 50 ms; double-frame p95 < 100 ms',
        before,
        afterUpdate,
        afterTyping: await cdp.send('Runtime.getHeapUsage'),
        positions,
      },
      null,
      2,
    ) + '\n',
  )
  for (const position of positions) {
    expect(position.syncP95).toBeLessThan(50)
    expect(position.doubleFrameP95).toBeLessThan(100)
  }
  await expect(page.locator('.draft-reference-measure')).toHaveCount(0)
})

async function load(page: Page) {
  await page.goto('./#/draft')
  const body = page.locator('.draft-paper .tiptap')
  await body.waitFor()
  await body.evaluate(
    (element, png) => {
      const editor = (element as HTMLElement & { editor: Editor }).editor
      const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
      const caption = (id: string, label: string, title: string) => ({
        type: 'paragraph',
        attrs: { anchorId: id, captionLabel: label, captionPosition: 'below' },
        content: [
          { type: 'captionNumber', attrs: { label, number: 99 } },
          { type: 'text', text: `: ${title}` },
        ],
      })
      const image = () => ({
        type: 'paragraph',
        content: [
          {
            type: 'image',
            attrs: { src: `data:image/png;base64,${png}`, width: 80, height: 40, alt: 'Synthetic figure' },
          },
        ],
      })
      const toc = (captionLabel?: string) => ({
        type: 'tableOfContents',
        attrs: { minLevel: 1, maxLevel: 3, captionLabel: captionLabel || null },
        content: [],
      })
      const ref = (targetId: string, format: string) => ({
        type: 'crossReference',
        attrs: { targetId, format, label: 'stale' },
      })
      editor.commands.setContent({
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { anchorId: 'intro', level: 1 },
            content: [{ type: 'text', text: 'Introduction' }],
          },
          p('Stable caret'),
          toc(),
          toc('Figure'),
          toc('Table'),
          {
            type: 'paragraph',
            content: [
              ref('fig_a', 'number'),
              { type: 'text', text: ' on page ' },
              ref('fig_a', 'page'),
              ref('source', 'number'),
              ref('source', 'page'),
            ],
          },
          {
            type: 'heading',
            attrs: { anchorId: 'detail', level: 1, pageBreakBefore: 1 },
            content: [{ type: 'text', text: 'Details' }],
          },
          image(),
          caption('fig_a', 'Figure', 'Alpha'),
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Source ' },
              { type: 'noteReference', attrs: { id: 'source', kind: 'footnote' } },
            ],
          },
          {
            type: 'heading',
            attrs: { anchorId: 'measurements', level: 1, pageBreakBefore: 1 },
            content: [{ type: 'text', text: 'Measurements' }],
          },
          image(),
          caption('fig_b', 'Figure', 'Beta'),
          caption('tab_a', 'Table', 'Data'),
          { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('Cell')] }] }] },
          { type: 'note', attrs: { id: 'source', kind: 'footnote' }, content: [p('Synthetic source text')] },
        ],
      })
      let caret = 1
      editor.state.doc.descendants((node, pos) => {
        if (node.isTextblock && node.textContent === 'Stable caret') caret = pos + 1
      })
      editor.commands.setTextSelection(caret)
    },
    Buffer.from(generatedPNG(160, 80)).toString('base64'),
  )
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('.draft-sheet')).toHaveCount(3)
  return body
}
async function update(page: Page, locale = 'en') {
  await page.getByRole('tab', { name: locale === 'en' ? 'Insert' : 'Wstawianie', exact: true }).click()
  await page.getByRole('button', { name: locale === 'en' ? 'References' : 'Odwołania', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog
    .getByRole('button', { name: locale === 'en' ? 'Update reference' : 'Aktualizuj odsyłacz', exact: true })
    .click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.draft-reference-measure')).toHaveCount(0)
}

test('TOC/list pages, dot leaders, caption numbering and note/page references update after reorder', async ({
  page,
}) => {
  const body = await load(page)
  await expect(body.locator('[data-draft-ref="fig_a"]').first()).toHaveText('stale')
  await update(page)
  await expect(body.locator('[data-draft-toc]').nth(0).locator('.draft-toc-page')).toHaveText(['1', '2', '3'])
  await expect(body.locator('[data-draft-toc]').nth(1).locator('.draft-toc-label')).toHaveText([
    'Figure 1: Alpha',
    'Figure 2: Beta',
  ])
  await expect(body.locator('[data-draft-toc]').nth(1).locator('.draft-toc-page')).toHaveText(['2', '3'])
  await expect(body.locator('[data-draft-ref="source"]')).toHaveText(['1', '2'])
  const aligns = await body
    .locator('[data-draft-toc]')
    .first()
    .locator('.draft-toc-page')
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().right))
  expect(Math.max(...aligns) - Math.min(...aligns)).toBeLessThan(1)
  expect(
    await body
      .locator('.draft-toc-leader')
      .first()
      .evaluate((element) => getComputedStyle(element).borderBottomStyle),
  ).toBe('dotted')
  await body.evaluate((element) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor
    const json = editor.getJSON()
    const a = json.content!.findIndex((node) => node.attrs?.anchorId === 'fig_a')
    const b = json.content!.findIndex((node) => node.attrs?.anchorId === 'fig_b')
    ;[json.content![a], json.content![b]] = [json.content![b], json.content![a]]
    editor.commands.setContent(json)
  })
  await expect(body.locator('[data-caption-number="Figure"]')).toHaveText(['Figure 1', 'Figure 2'])
  await expect(body.locator('[data-draft-ref="fig_a"]').first()).toHaveText('Figure 1')
  await update(page)
  await expect(body.locator('[data-draft-ref="fig_a"]')).toHaveText(['Figure 2', '3'])
  await expect(body.locator('[data-draft-toc]').nth(1).locator('.draft-toc-label')).toHaveText([
    'Figure 1: Beta',
    'Figure 2: Alpha',
  ])
})

test('export refreshes caches without changing the live content, selection or web/zoom view', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }),
  )
  const body = await load(page)
  await page.getByRole('tab', { name: 'View', exact: true }).click()
  await page.getByRole('combobox', { name: 'Document view', exact: true }).selectOption('web')
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('125')
  const before = await body.evaluate((element) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor
    return { json: JSON.stringify(editor.getJSON()), selection: editor.state.selection.from }
  })
  await page.getByRole('tab', { name: 'File', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const chunks: Buffer[] = []
  for await (const chunk of await (await downloading).createReadStream()) chunks.push(Buffer.from(chunk))
  const xml = strFromU8(unzipSync(Buffer.concat(chunks))['word/document.xml'])
  for (const field of ['TOC \\o', 'TOC \\c', 'REF fig_a_number', 'PAGEREF fig_a', 'SEQ &quot;Figure&quot;'])
    expect(xml).toContain(field)
  expect(xml).toContain('>2</w:t>')
  expect(xml).not.toContain('stale')
  expect(
    await body.evaluate((element) => JSON.stringify((element as HTMLElement & { editor: Editor }).editor.getJSON())),
  ).toBe(before.json)
  expect(
    await body.evaluate((element) => (element as HTMLElement & { editor: Editor }).editor.state.selection.from),
  ).toBe(before.selection)
  await expect(page.locator('.draft-page--web')).toHaveCSS('zoom', '1.25')
  await expect(page.locator('.draft-reference-measure')).toHaveCount(0)
  expect(await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage))).not.toMatch(
    /Introduction|Synthetic|fig_a/,
  )
})

test('custom EN/PL labels, caption positions and caption lists use the references dialog', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('allsuite:locale', 'pl'))
  await page.goto('./#/draft')
  const body = page.locator('.draft-paper .tiptap')
  await body.fill('Obiekt')
  const open = async (kind: string) => {
    await page.getByRole('tab', { name: 'Wstawianie', exact: true }).click()
    await page.getByRole('button', { name: 'Odwołania', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('combobox', { name: 'Typ odwołania', exact: true }).selectOption(kind)
    return dialog
  }
  let dialog = await open('caption')
  await expect(dialog.getByRole('combobox', { name: 'Etykieta', exact: true })).toHaveValue('Rysunek')
  await dialog.getByRole('textbox', { name: 'Tekst podpisu', exact: true }).fill('Zażółć')
  await dialog.getByRole('combobox', { name: 'Położenie podpisu', exact: true }).selectOption('above')
  await dialog.getByRole('button', { name: 'Wstaw', exact: true }).click()
  await expect(body.locator('p').first()).toHaveText('Rysunek 1: Zażółć')
  dialog = await open('labels')
  await dialog
    .getByRole('textbox', { name: 'Etykiety (oddzielone przecinkami)', exact: true })
    .fill('Rysunek, Tabela, Diagram')
  await dialog.getByRole('button', { name: 'Zastosuj', exact: true }).click()
  dialog = await open('figures')
  await dialog.getByRole('button', { name: 'Wstaw', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(body.locator('.draft-toc-label')).toHaveText('Rysunek 1: Zażółć')
  await expect(body.locator('.draft-toc-page')).toHaveText('1')
})

test('reference pages use the physical layout with rich header space, Roman format and a non-default start', async ({
  page,
}) => {
  const body = await load(page)
  await body.evaluate((element) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor
    const setup = JSON.parse(editor.state.doc.attrs.pageSetup)
    const story = [
      {
        type: 'paragraph',
        content: Array.from({ length: 8 }, (_, i) => [
          { type: 'text', text: `Header line ${i}` },
          { type: 'hardBreak' },
        ]).flat(),
      },
    ]
    setup.stories = {
      differentFirst: false,
      differentEven: false,
      start: 7,
      format: 'lowerRoman',
      title: '',
      header: { default: story, first: [{ type: 'paragraph' }], even: [{ type: 'paragraph' }] },
      footer: { default: [{ type: 'paragraph' }], first: [{ type: 'paragraph' }], even: [{ type: 'paragraph' }] },
    }
    editor.view.dispatch(editor.state.tr.setDocAttribute('pageSetup', JSON.stringify(setup)))
  })
  await expect(page.locator('.draft-page-band--top').first()).toContainText('Header line 7')
  await update(page)
  await expect(body.locator('[data-draft-toc]').first().locator('.draft-toc-page')).toHaveText(['vii', 'viii', 'ix'])
  await expect(body.locator('[data-draft-ref="fig_a"]')).toHaveText(['Figure 1', 'viii'])
})
