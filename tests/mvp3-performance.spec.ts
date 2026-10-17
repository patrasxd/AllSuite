import { expect, test } from '@playwright/test'
import type { Editor } from '@tiptap/core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { generatedPNG } from './fixtures/png'

// Fixed corpus and sampling method. Report the 300-page result even if it exceeds the
// existing 100-page responsiveness budget; do not silently redefine that budget.
for (const pages of [100, 300])
  test(`MVP 3 benchmark ${pages} mixed physical pages`, async ({ page, context }) => {
    test.setTimeout(300000)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.addInitScript(() => {
      window.confirm = () => true
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
    })
    await page.goto('./#/draft')
    const body = page.locator('.draft-paper .tiptap')
    await expect(body).toBeVisible()
    const image = Buffer.from(generatedPNG(160, 80)).toString('base64')
    const initMs = await body.evaluate(
      (element, { pages, image }) => {
        const editor = (element as HTMLElement & { editor: Editor }).editor
        const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
        const setup = JSON.parse(editor.state.doc.attrs.pageSetup)
        const header = [p('MVP 3 synthetic benchmark')]
        const footer = [
          {
            type: 'paragraph',
            content: [
              { type: 'storyField', attrs: { field: 'PAGE' } },
              { type: 'text', text: ' / ' },
              { type: 'storyField', attrs: { field: 'NUMPAGES' } },
            ],
          },
        ]
        setup.stories = {
          differentFirst: false,
          differentEven: false,
          format: 'decimal',
          start: 1,
          title: 'MVP 3 benchmark',
          header: { default: header, first: [], even: [] },
          footer: { default: footer, first: [], even: [] },
        }
        const start = performance.now()
        editor.commands.setContent({
          type: 'doc',
          content: Array.from({ length: pages }, (_, i) => [
            {
              type: 'heading',
              attrs: { level: 2, anchorId: `mvp3_${i}`, pageBreakBefore: i ? 1 : null },
              content: [{ type: 'text', text: `PAGE-${i + 1}` }],
            },
            p('Zażółć gęślą jaźń. Natural wrapping with local fonts and selectable text. '.repeat(8)),
            {
              type: 'table',
              content: Array.from({ length: 3 }, (_, row) => ({
                type: 'tableRow',
                attrs: { repeatHeader: row === 0 },
                content: [
                  { type: row ? 'tableCell' : 'tableHeader', content: [p(`Row ${row}`)] },
                  { type: row ? 'tableCell' : 'tableHeader', content: [p(`Value ${i}`)] },
                ],
              })),
            },
            {
              type: 'paragraph',
              content: [
                {
                  type: 'image',
                  attrs: { src: `data:image/png;base64,${image}`, width: 160, height: 80, alt: `Synthetic image ${i}` },
                },
              ],
            },
          ]).flat(),
        })
        editor.view.dispatch(editor.state.tr.setDocAttribute('pageSetup', JSON.stringify(setup)))
        return performance.now() - start
      },
      { pages, image },
    )
    await page.evaluate(() => document.fonts.ready)
    await expect(page.locator('.draft-sheet')).toHaveCount(pages)
    const cdp = await context.newCDPSession(page)
    const heap = async () => {
      await cdp.send('HeapProfiler.collectGarbage')
      return cdp.send('Runtime.getHeapUsage')
    }
    const loaded = await heap()
    const positions = []
    for (const part of ['start', 'middle', 'end']) {
      await body.evaluate((element, part) => {
        const editor = (element as HTMLElement & { editor: Editor }).editor
        const positions: number[] = []
        editor.state.doc.descendants((node, pos) => {
          if (node.isTextblock) positions.push(pos + 1)
        })
        editor.commands.setTextSelection(
          positions[part === 'start' ? 0 : part === 'middle' ? Math.floor(positions.length / 2) : positions.length - 1],
        )
        editor.chain().focus().scrollIntoView().run()
      }, part)
      const samples = []
      for (let i = 0; i < 35; i++) {
        const sample = await body.evaluate(async (element) => {
          const editor = (element as HTMLElement & { editor: Editor }).editor
          const start = performance.now()
          editor.commands.insertContent('x')
          element.getBoundingClientRect()
          const sync = performance.now() - start
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          return { sync, frame: performance.now() - start }
        })
        if (i >= 5) samples.push(sample)
      }
      const percentile = (key: 'sync' | 'frame') => samples.map((x) => x[key]).sort((a, b) => a - b)[28]
      positions.push({ part, syncP95: percentile('sync'), doubleFrameP95: percentile('frame') })
    }
    const edited = await heap()
    const scroll = await page.locator('.draft-document-area').evaluate(async (element) => {
      const distance = element.scrollHeight - element.clientHeight
      const samples: number[] = []
      for (let i = 0; i < 125; i++) {
        const start = performance.now()
        element.scrollTop = (element.scrollHeight - element.clientHeight) * ((i % 60) / 59)
        await new Promise((resolve) => requestAnimationFrame(resolve))
        if (i >= 5) samples.push(performance.now() - start)
      }
      const sorted = [...samples].sort((a, b) => a - b)
      return {
        distance,
        samples,
        p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
        maxMs: Math.max(...samples),
        framesOver50Ms: samples.filter((x) => x > 50).length,
      }
    })
    expect(scroll.distance).toBeGreaterThan(pages * 100)
    await page.getByRole('tab', { name: 'File', exact: true }).click()
    let start = performance.now()
    const docxEvent = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    const docx = await docxEvent
    const docxChunks: Buffer[] = []
    for await (const chunk of await docx.createReadStream()) docxChunks.push(Buffer.from(chunk))
    const docxMs = performance.now() - start
    start = performance.now()
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    const pdfEvent = page.waitForEvent('download', { timeout: 180000 })
    await page.getByRole('menuitem', { name: 'PDF', exact: true }).click()
    const pdfDownload = await pdfEvent,
      chunks: Buffer[] = []
    for await (const chunk of await pdfDownload.createReadStream()) chunks.push(Buffer.from(chunk))
    const pdfMs = performance.now() - start,
      pdf = Buffer.concat(chunks)
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(pages)
    start = performance.now()
    await page.getByRole('button', { name: 'Print preview', exact: true }).click()
    await expect(page.frameLocator('iframe[title="Print preview"]').locator('.print-sheet')).toHaveCount(pages, {
      timeout: 180000,
    })
    const previewMs = performance.now() - start
    await page.getByRole('button', { name: 'Back to editor', exact: true }).click()
    const afterExport = await heap()
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await expect(page.locator('.draft-sheet')).toHaveCount(1)
    const afterNew = await heap()
    const result = {
      pages,
      browser: context.browser()?.version(),
      viewport: { width: 1280, height: 800 },
      initMs,
      positions,
      scroll,
      memory: { loaded, edited, afterExport, afterNew },
      export: {
        docxMs,
        docxBytes: Buffer.concat(docxChunks).length,
        pdfColdMs: pdfMs,
        pdfBytes: pdf.length,
        previewWarmMs: previewMs,
      },
      within100PageBudget: positions.every((x) => x.syncP95 < 50 && x.doubleFrameP95 < 100),
    }
    mkdirSync('docs/mvp3-gate', { recursive: true })
    writeFileSync(`docs/mvp3-gate/performance-${pages}.json`, JSON.stringify(result, null, 2) + '\n')
    // Performance observations remain available even when a budget fails.
    if (pages === 100) expect(result.within100PageBudget).toBe(true)
  })
