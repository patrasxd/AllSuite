import { expect, test } from '@playwright/test'
import type { Editor } from '@tiptap/core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { generatedPNG } from './fixtures/png'
import { chromiumPDFPages } from './fixtures/pdf-text'

test('100 mixed pages retain responsive editing with rich repeating stories and semantic printing', async ({
  page,
  context,
}) => {
  test.setTimeout(120000)
  const evidence = 'docs/stories-audit'
  mkdirSync(evidence, { recursive: true })
  await context.addInitScript(() => {
    window.print = () => {
      document.documentElement.dataset.printRequested = 'true'
    }
  })
  await page.goto('./#/draft')
  const editor = page.locator('.tiptap')
  await expect(editor).toBeVisible()
  const png = Buffer.from(generatedPNG(160, 80)).toString('base64')
  const create = async (counters: boolean) =>
    editor.evaluate(
      (element, { png, counters }) => {
        const editor = (element as HTMLElement & { editor: Editor }).editor
        const p = (text: string) => ({
          type: 'paragraph',
          content: [{ type: 'text', text, marks: [{ type: 'textStyle', attrs: { fontFamily: 'Calibri' } }] }],
        })
        const attrs = { ...editor.getJSON().attrs }
        const setup = JSON.parse(attrs.pageSetup)
        setup.pageNumbers = counters
        setup.headerText = counters ? 'Benchmark header' : ''
        if (counters) {
          const header = (label: string) => [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: label, marks: [{ type: 'bold' }] },
                { type: 'storyField', attrs: { field: 'TITLE' } },
              ],
            },
          ]
          const footer = [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'image',
                  attrs: { src: `data:image/png;base64,${png}`, width: 64, height: 32, alt: 'Synthetic logo' },
                },
                { type: 'storyField', attrs: { field: 'PAGE' } },
                { type: 'text', text: ' / ' },
                { type: 'storyField', attrs: { field: 'NUMPAGES' } },
              ],
            },
          ]
          setup.stories = {
            differentFirst: true,
            differentEven: true,
            format: 'upperRoman',
            start: 7,
            title: 'Benchmark title',
            header: { default: header('Odd '), first: header('First '), even: header('Even ') },
            footer: { default: footer, first: footer, even: footer },
          }
          setup.headerText = ''
          setup.pageNumbers = false
        }
        attrs.pageSetup = JSON.stringify(setup)
        const start = performance.now()
        editor.commands.setContent({
          type: 'doc',
          attrs,
          content: Array.from({ length: 100 }, (_, i) => [
            {
              type: 'heading',
              attrs: { level: 2, pageBreakBefore: i ? 1 : null },
              content: [{ type: 'text', text: `PAGE-${i + 1}` }],
            },
            p('Zażółć gęślą jaźń. A paragraph with natural wrapping and local fonts. '.repeat(8)),
            {
              type: 'table',
              content: Array.from({ length: 3 }, (_, row) => ({
                type: 'tableRow',
                attrs: { repeatHeader: row === 0 },
                content: [
                  { type: row ? 'tableCell' : 'tableHeader', content: [p(`Cell ${row}`)] },
                  { type: row ? 'tableCell' : 'tableHeader', content: [p(`Value ${i}`)] },
                ],
              })),
            },
            {
              type: 'paragraph',
              content: [
                {
                  type: 'image',
                  attrs: { src: `data:image/png;base64,${png}`, width: 160, height: 80, alt: `Image ${i}` },
                },
              ],
            },
          ]).flat(),
        })
        editor.view.dispatch(editor.state.tr.setDocAttribute('pageSetup', attrs.pageSetup))
        return performance.now() - start
      },
      { png, counters },
    )
  const cdp = await context.newCDPSession(page)
  const results = []
  // Comparative budget chosen before measurement: counters may add <= 2x baseline p95 + 5 ms.
  // Both arms use the complete production schema, UI, statistics and font loader.
  for (const counters of [false, true]) {
    if (counters) {
      // A fresh editor/history prevents retaining the preceding arm's synthetic document.
      await page.reload()
      await expect(editor).toBeVisible()
    }
    const initMs = await create(counters)
    await expect
      .poll(() =>
        page.evaluate(() => Array.from(document.fonts).some((face) => face.family.replace(/['"]/g, '') === 'Carlito')),
      )
      .toBe(true)
    await page.evaluate(() => document.fonts.ready)
    await expect(page.locator('.draft-sheet')).toHaveCount(100)
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await cdp.send('HeapProfiler.collectGarbage')
    const loaded = await cdp.send('Runtime.getHeapUsage')
    const positions = []
    for (const part of ['start', 'middle', 'end']) {
      await editor.evaluate((element, part) => {
        const editor = (element as HTMLElement & { editor: Editor }).editor
        const nodes: number[] = []
        editor.state.doc.descendants((node, pos) => {
          if (node.isTextblock) nodes.push(pos + 1)
        })
        editor.commands.setTextSelection(
          nodes[part === 'start' ? 0 : part === 'middle' ? Math.floor(nodes.length / 2) : nodes.length - 1],
        )
        editor.chain().focus().scrollIntoView().run()
      }, part)
      const sync = [],
        frame = []
      for (let i = 0; i < 35; i++) {
        const sample = await editor.evaluate(async (element) => {
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
          frame.push(sample.frame)
        }
      }
      const p95 = (values: number[]) => values.sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]
      positions.push({ part, syncP95: p95(sync), doubleFrameP95: p95(frame) })
    }
    await cdp.send('HeapProfiler.collectGarbage')
    results.push({ counters, initMs, loaded, edited: await cdp.send('Runtime.getHeapUsage'), positions })
  }
  // Print the unedited mixed corpus, not the benchmark's insertion history.
  await create(true)
  await page.getByRole('tab', { name: 'File', exact: true }).click()
  const popup = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Print', exact: true }).click()
  const print = await popup
  await expect(print.locator('html')).toHaveAttribute('data-print-requested', 'true', { timeout: 30000 })
  const rendering = await context.newPage()
  await rendering.setContent(await print.content())
  await rendering.evaluate(async () => {
    await Promise.all(Array.from(document.fonts, (face) => face.load()))
    await document.fonts.ready
    await Promise.all(Array.from(document.images, (image) => image.decode()))
  })
  const pdf = await rendering.pdf({ path: `${evidence}/mixed-hundred.pdf`, preferCSSPageSize: true })
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length
  const printed = chromiumPDFPages(pdf)
  writeFileSync(`${evidence}/print-text.json`, JSON.stringify(printed, null, 2) + '\n')
  expect(printed[0]).toContain('First Benchmark title')
  expect(printed[1]).toContain('Even Benchmark title')
  expect(printed[2]).toContain('Odd Benchmark title')
  expect(printed[0]).toContain('VII / 100')
  expect(printed[99]).toContain('CVI / 100')
  writeFileSync(
    `${evidence}/performance.json`,
    JSON.stringify(
      {
        browser: context.browser()?.version(),
        pages,
        budget: 'sync p95 < 50 ms; two-frame p95 < 100 ms; counters sync p95 < baseline * 2 + 5 ms',
        results,
      },
      null,
      2,
    ) + '\n',
  )
  expect(pages).toBe(100)
  await expect(page.locator('.draft-sheet')).toHaveCount(100)
  await print.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await rendering.close()
  for (let i = 0; i < 3; i++)
    expect(results[1].positions[i].syncP95).toBeLessThan(results[0].positions[i].syncP95 * 2 + 5)
  // Keep failed-budget measurements reviewable too; thresholds precede this task's runs.
  for (const result of results)
    for (const position of result.positions) {
      expect(position.syncP95).toBeLessThan(50)
      expect(position.doubleFrameP95).toBeLessThan(100)
    }
})
