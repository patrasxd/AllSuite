import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

const out = resolve(process.argv[2] || 'docs/adr/pagination-evidence')
const printEvidence = !process.argv.includes('--no-pdf')
await mkdir(out, { recursive: true })
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  server: { host: '127.0.0.1', port: 5187, strictPort: true, hmr: false, watch: null },
})
await server.listen()
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' })
const results = {
  date: new Date().toISOString(),
  node: process.version,
  browser: browser.version(),
  viewport: [1280, 800],
  runs: [],
}
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1]
try {
  for (const approach of ['widgets', 'print']) {
    for (let run = 0; run < 3; run++) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.route('**/*', (route) =>
        new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
      )
      await page.goto(`http://127.0.0.1:5187/packages/apps/draft/spikes/pagination-${approach}/index.html`)
      await page.waitForFunction(() => !!window.spike)
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('HeapProfiler.collectGarbage')
      const baseline = await cdp.send('Runtime.getHeapUsage')
      const correctness = await page.evaluate(() => window.spike.inspect())
      assert.equal(correctness.oversized.length, 3, 'long paragraph, table, image exceed page body')
      if (run === 0) {
        await page.screenshot({ path: `${out}/${approach}-screen.png` })
        if (printEvidence)
          await page.pdf({ path: `${out}/${approach}-correctness.pdf`, preferCSSPageSize: true, printBackground: true })
      }
      const init = await page.evaluate(() => window.spike.load('hundred'))
      await cdp.send('HeapProfiler.collectGarbage')
      const loaded = await cdp.send('Runtime.getHeapUsage')
      const inspection = await page.evaluate(() => window.spike.inspect())
      const before = await page.evaluate(() => window.spike.json())
      if (approach === 'widgets') assert.equal(inspection.widgets, 99)
      assert.equal(inspection.oversized.length, 0)
      const typing = {}
      for (const part of ['start', 'middle', 'end']) {
        await page.evaluate((part) => window.spike.prepare(part), part)
        // Warm up both editor and automation path.
        for (let i = 0; i < 5; i++) await page.evaluate(() => window.spike.insert())
        const sync = [],
          frame = [],
          keyboard = []
        for (let i = 0; i < 30; i++) {
          const sample = await page.evaluate(async () => {
            const start = performance.now()
            const sync = window.spike.insert()
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            return { sync, frame: performance.now() - start }
          })
          sync.push(sample.sync)
          frame.push(sample.frame)
          const start = performance.now()
          await page.keyboard.type('y')
          await page.evaluate(
            () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          )
          keyboard.push(performance.now() - start)
        }
        typing[part] = {
          samples: 30,
          syncP50: percentile(sync, 0.5),
          syncP95: percentile(sync, 0.95),
          frameP95: percentile(frame, 0.95),
          keyboardRoundtripP95: percentile(keyboard, 0.95),
        }
      }
      assert.notEqual(await page.evaluate(() => window.spike.json()), before)
      await cdp.send('HeapProfiler.collectGarbage')
      const edited = await cdp.send('Runtime.getHeapUsage')
      if (run === 0 && printEvidence) {
        await page.evaluate(() => window.spike.load('hundred'))
        await page.pdf({ path: `${out}/${approach}-hundred.pdf`, preferCSSPageSize: true })
      }
      assert.deepEqual(errors, [])
      results.runs.push({ approach, run, init, correctness, inspection, baseline, loaded, edited, typing })
      await page.close()
    }
  }
  await writeFile(`${out}/measurements.json`, JSON.stringify(results, null, 2) + '\n')
  console.log(JSON.stringify(results, null, 2))
} finally {
  await browser.close()
  await server.close()
}
