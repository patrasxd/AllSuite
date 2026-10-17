import { expect, test, type Page, type Locator } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { strFromU8, unzipSync } from 'fflate'
import { mixedDocx, imageHeavyDocx } from './fixtures/mvp2'
import type { Editor } from '@tiptap/core'

const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
async function open(page: Page, buffer: Uint8Array | string, name = 'release-fixture.docx') {
  await page.getByRole('tab', { name: /^(File|Plik)$/ }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /^(Open|Otwórz)$/ }).click()
  const selected = await chooser
  await selected.setFiles(typeof buffer === 'string' ? buffer : { name, mimeType, buffer: Buffer.from(buffer) })
  // FileChooser owns a protocol handle to the removed native input and its shadow DOM.
  // Release the harness handle so memory samples measure the app rather than automation.
  await selected.element().dispose()
}
async function assertMixed(page: Page) {
  const editor = page.locator('.tiptap')
  await expect(editor.locator('h1')).toHaveText('Release introduction')
  await expect(editor.locator('h2')).toHaveText('Release details')
  await expect(editor.locator('ol')).toContainText('First numbered item')
  await expect(editor.locator('ol ul')).toContainText('Nested bullet item')
  await expect(editor.locator('table tr')).toHaveCount(2)
  await expect(editor.locator('table')).toContainText('Release cell')
  await expect(editor.locator('img[src]')).toHaveCount(2)
  await expect(editor.locator('img[alt="Release fixture image"]')).toHaveAttribute('src', /^data:image\/png/)
  await expect(editor.locator('img[alt="Quarterly sales; Revenue"]')).toHaveAttribute('src', /^data:image\/png/)
  await expect(editor.locator('.draft-note')).toContainText('Release footnote source')
  await expect(editor.locator('[data-draft-toc]')).toContainText('Release introduction')
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true })
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
    const live = { workers: 0, urls: 0 }
    Object.assign(window, { __mvp2Live: live })
    const OriginalWorker = Worker
    window.Worker = class extends OriginalWorker {
      private active = true
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        live.workers++
      }
      terminate() {
        if (this.active) {
          live.workers--
          this.active = false
        }
        super.terminate()
      }
    }
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL)
    const urls = new Set<string>()
    URL.createObjectURL = (blob) => {
      const url = create(blob)
      urls.add(url)
      live.urls = urls.size
      return url
    }
    URL.revokeObjectURL = (url) => {
      urls.delete(url)
      live.urls = urls.size
      revoke(url)
    }
  })
})

test('combined fixture imports, edits, exports twice and leaves no document storage or external requests', async ({
  page,
  context,
}) => {
  const requests: string[] = []
  context.on('request', (r) => requests.push(r.url()))
  await page.goto('./#/draft')
  await open(page, mixedDocx())
  const report = page.getByRole('dialog', { name: 'Import report', exact: true })
  await expect(report).toContainText('converted to images')
  await report.getByRole('button', { name: 'Continue', exact: true }).click()
  await assertMixed(page)
  await page.locator('.tiptap table tr').last().locator('p').first().click()
  await page.keyboard.press('End')
  await page.keyboard.type(' edited')
  for (let pass = 0; pass < 2; pass++) {
    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    const chunks: Buffer[] = []
    for await (const chunk of await (await downloading).createReadStream()) chunks.push(Buffer.from(chunk))
    const packed = Buffer.concat(chunks)
    const files = unzipSync(packed)
    expect(strFromU8(files['word/document.xml'])).toContain('edited')
    expect(strFromU8(files['word/footnotes.xml'])).toContain('Release footnote source')
    expect(Object.keys(files).some((p) => p.startsWith('word/charts/'))).toBe(false)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await expect(page.locator('.tiptap img')).toHaveCount(0)
    await open(page, packed, `round-trip-${pass}.docx`)
    await assertMixed(page)
    await expect(page.locator('.tiptap table')).toContainText('Release cell edited')
    await expect(report).toHaveCount(0)
  }
  // Browser-internal download UI and local data/blob images do not issue network requests.
  expect(requests.filter((url) => /^https?:/.test(url) && new URL(url).origin !== new URL(page.url()).origin)).toEqual(
    [],
  )
  const storage = await page.evaluate(async () => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
    databases: await indexedDB.databases(),
    cookies: document.cookie,
    caches: await Promise.all(
      (await caches.keys()).map(async (key) => (await (await caches.open(key)).keys()).map((r) => r.url)),
    ),
  }))
  expect(
    Object.keys(storage.local).every((key) =>
      ['allsuite:locale', 'allsuite:theme', 'allsuite:draft:view-preferences', 'allsuite:draft:image-options'].includes(
        key,
      ),
    ),
  ).toBe(true)
  expect(JSON.stringify(storage)).not.toMatch(/Release|Revenue|data:image|\.docx/)
  expect(storage.session).toEqual({})
  expect(storage.databases).toEqual([])
  expect(storage.cookies).toBe('')
  expect(
    storage.caches
      .flat()
      .filter(
        (url) =>
          !/\/AllSuite\/(?:$|assets\/|index\.html|third-party-licenses\.txt|manifest\.webmanifest|icons\/|registerSW\.js)/.test(
            url,
          ),
      ),
  ).toEqual([])
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __mvp2Live: object }).__mvp2Live))
    .toEqual({ workers: 0, urls: 0 })
})

test('20 MB image document stays responsive and releases image/history graphs across repeated replacement', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000)
  const fixture = imageHeavyDocx()
  expect(fixture.byteLength).toBeGreaterThanOrEqual(20_000_000)
  expect(fixture.byteLength).toBeLessThan(26_000_000)
  await page.goto('./#/draft')
  const cdp = await context.newCDPSession(page)
  await page.evaluate(() => {
    const timings = { gaps: [] as number[], longTasks: [] as number[] }
    Object.assign(window, { __mvp2Timings: timings })
    let previous = performance.now()
    setInterval(() => {
      const now = performance.now()
      timings.gaps.push(now - previous)
      previous = now
    }, 25)
    new PerformanceObserver((list) => timings.longTasks.push(...list.getEntries().map((e) => e.duration))).observe({
      type: 'longtask',
      buffered: false,
    })
  })
  const samples = []
  for (let cycle = 0; cycle < 4; cycle++) {
    // Native file paths avoid Playwright's synchronous 20 MB base64 injection into the page.
    const file = `test-results/mvp2-stress-${cycle}.docx`
    await writeFile(file, cycle ? imageHeavyDocx(48, cycle * 48) : fixture)
    const start = Date.now()
    await open(page, file)
    await expect(page.locator('.tiptap img[src]')).toHaveCount(48, { timeout: 30_000 })
    await expect
      .poll(
        () =>
          page
            .locator('.tiptap img[src]')
            .evaluateAll((images) => images.filter((image) => (image as HTMLImageElement).naturalWidth === 512).length),
        { timeout: 30_000 },
      )
      .toBe(48)
    const importedMs = Date.now() - start
    const editStart = Date.now()
    await page.locator('.tiptap p').first().click()
    await page.keyboard.press('End')
    await page.keyboard.type(' responsive')
    await expect(page.locator('.tiptap p').first()).toContainText('responsive')
    const editMs = Date.now() - editStart
    await cdp.send('HeapProfiler.collectGarbage')
    const loaded = await cdp.send('Runtime.getHeapUsage')
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await expect(page.locator('.tiptap img')).toHaveCount(0)
    await page.locator('.tiptap').evaluate((element) => {
      const editor = (element as HTMLElement & { editor: Editor }).editor
      if (editor.can().undo()) throw new Error('Old image history retained')
    })
    await cdp.send('HeapProfiler.collectGarbage')
    await cdp.send('Memory.prepareForLeakDetection')
    const empty = await cdp.send('Runtime.getHeapUsage')
    const dom = await cdp.send('Memory.getDOMCounters')
    samples.push({
      cycle,
      importedMs,
      editMs,
      loadedHeap: loaded.usedSize,
      emptyHeap: empty.usedSize,
      loaded,
      empty,
      ...dom,
    })
    expect(editMs).toBeLessThan(1500)
    expect(importedMs).toBeLessThan(30_000)
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __mvp2Live: object }).__mvp2Live))
      .toEqual({ workers: 0, urls: 0 })
  }
  const timings = await page.evaluate(
    () => (window as unknown as { __mvp2Timings: { gaps: number[]; longTasks: number[] } }).__mvp2Timings,
  )
  const sorted = [...timings.gaps].sort((a, b) => a - b)
  await page.getByRole('button', { name: 'Back to AllSuite', exact: true }).click()
  await expect(page.locator('.tiptap')).toHaveCount(0)
  await cdp.send('Memory.prepareForLeakDetection')
  const unmounted = await cdp.send('Runtime.getHeapUsage')
  const unmountedDOM = await cdp.send('Memory.getDOMCounters')
  await cdp.send('Network.clearBrowserCache')
  await cdp.send('Memory.simulatePressureNotification', { level: 'critical' })
  await cdp.send('HeapProfiler.collectGarbage')
  const afterPressure = await cdp.send('Runtime.getHeapUsage')
  const metrics = {
    fixtureBytes: fixture.byteLength,
    images: 48,
    samples,
    unmounted,
    unmountedDOM,
    afterPressure,
    maxHeartbeatGapMs: Math.max(...timings.gaps),
    p95HeartbeatGapMs: sorted[Math.floor(sorted.length * 0.95)],
    maxLongTaskMs: Math.max(0, ...timings.longTasks),
  }
  await mkdir('docs/mvp2-gate', { recursive: true })
  await writeFile('docs/mvp2-gate/memory.json', JSON.stringify(metrics, null, 2) + '\n')
  // Compare warmed cycles after forced GC; allow allocator/editor/font initialization noise.
  expect(samples[3].emptyHeap - samples[1].emptyHeap).toBeLessThan(8 * 1024 * 1024)
  expect((samples[3].empty.backingStorageSize || 0) - (samples[1].empty.backingStorageSize || 0)).toBeLessThan(
    8 * 1024 * 1024,
  )
  expect(samples[3].nodes - samples[1].nodes).toBeLessThan(100)
  expect(metrics.p95HeartbeatGapMs).toBeLessThan(100)
  expect(metrics.maxLongTaskMs).toBeLessThan(1500)
  // Browser caches may retain images after unmount; pressure must reclaim their strings.
  expect(afterPressure.backingStorageSize || 0).toBeLessThan(8 * 1024 * 1024)
})

async function accessibleControls(container: Locator, touch: boolean) {
  const controls = container.locator('button, input:not([type="file"]), select, [role="menuitem"]')
  for (const control of await controls.all()) {
    if (!(await control.isVisible())) continue
    await expect(control).toHaveAccessibleName(/\S/)
    if (touch) {
      const bounds = (await control.boundingBox())!
      expect(bounds.width).toBeGreaterThanOrEqual(44)
      expect(bounds.height).toBeGreaterThanOrEqual(44)
    }
    if (!(await control.isDisabled())) {
      await control.focus()
      await expect(control).toBeFocused()
      expect(
        await control.evaluate((element) => {
          const style = getComputedStyle(element)
          return parseFloat(style.outlineWidth) > 0 || style.boxShadow !== 'none'
        }),
      ).toBe(true)
    }
  }
}

for (const theme of ['dark', 'light', 'e-ink-light', 'e-ink-dark'])
  for (const locale of ['en', 'pl']) {
    test(`MVP 2 controls have names, focus and touch targets ${theme} ${locale}`, async ({ page }) => {
      const touch = locale === 'pl'
      await page.setViewportSize(touch ? { width: 390, height: 844 } : { width: 1280, height: 800 })
      await page.addInitScript(
        ({ theme, locale }) => {
          localStorage.setItem('allsuite:theme', theme)
          localStorage.setItem('allsuite:locale', locale)
        },
        { theme, locale },
      )
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto('./#/draft')
      await open(page, mixedDocx())
      await page
        .getByRole('dialog')
        .getByRole('button', { name: /^(Continue|Kontynuuj)$/ })
        .click()
      await page.locator('.tiptap table p').first().click()
      await accessibleControls(page.locator('.draft-table-tools'), touch)
      await page.getByRole('tab', { name: /^(Format|Formatowanie)$/ }).click()
      const styles = page.getByRole('combobox', { name: /^(Text style|Styl tekstu)$/ })
      await expect(styles.locator('option')).toHaveCount(12)
      await styles.focus()
      await expect(styles).toBeFocused()
      await page.getByRole('tab', { name: /^(Insert|Wstawianie)$/ }).click()
      await page.getByRole('button', { name: /^(Insert image|Wstaw obraz)$/ }).click()
      await expect(page.getByRole('dialog')).toHaveCSS('animation-name', 'none')
      await expect(page.locator('.all-dialog-overlay')).toHaveCSS('animation-name', 'none')
      await accessibleControls(page.getByRole('dialog'), touch)
      if (!touch) {
        for (const [width, height] of [
          [844, 390],
          [820, 1180],
          [1920, 1080],
        ]) {
          await page.setViewportSize({ width, height })
          const dialog = page.getByRole('dialog')
          const box = (await dialog.boundingBox())!
          expect(box.x).toBeGreaterThanOrEqual(0)
          expect(box.y).toBeGreaterThanOrEqual(0)
          expect(box.x + box.width).toBeLessThanOrEqual(width)
          expect(box.y + box.height).toBeLessThanOrEqual(height)
          await accessibleControls(dialog, width <= 900)
          await page.screenshot({ path: `docs/mvp2-gate/image-dialog-${theme}-${width}.png` })
        }
        await page.setViewportSize({ width: 1280, height: 800 })
      }
      await page.keyboard.press('Escape')
      await page.getByRole('tab', { name: /^(View|Widok)$/ }).click()
      await page.getByRole('button', { name: /^(Navigation|Nawigacja)$/ }).click()
      await accessibleControls(page.getByRole('navigation', { name: /^(Navigation|Nawigacja)$/ }), touch)
      if (touch) await page.keyboard.press('Escape')
      await page.getByRole('tab', { name: /^(File|Plik)$/ }).click()
      const trigger = page.getByRole('button', { name: /^(Export|Eksportuj)$/ })
      await trigger.focus()
      await trigger.press('ArrowDown')
      await accessibleControls(page.getByRole('menu'), touch)
      await page.keyboard.press('Escape')
      await expect(trigger).toBeFocused()
    })
  }
