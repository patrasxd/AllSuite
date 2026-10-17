import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

// Read-only PDF review through the installed browser's own PDF renderer.
const server = await createServer({
  configFile: false,
  server: { host: '127.0.0.1', port: 5187, hmr: false, watch: null },
})
await server.listen()
const browser = await chromium.launch({ channel: 'msedge', headless: false })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  const counts = {}
  for (const name of ['print-correctness', 'print-hundred', 'widgets-correctness', 'widgets-hundred']) {
    const file = `docs/adr/pagination-evidence/${name}.pdf`
    const bytes = await readFile(file)
    counts[name] = [...bytes.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length
    if (name.endsWith('hundred')) assert.equal(counts[name], 100)
    await page.goto(`http://127.0.0.1:5187/${file}#page=2&zoom=75`)
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `docs/adr/pagination-evidence/${name}-review.png` })
    if (name === 'print-correctness') {
      for (const number of [4, 5, 6, 7, 8]) {
        await page.goto(`http://127.0.0.1:5187/${file}#page=${number}&zoom=100`)
        await page.reload()
        await page.waitForTimeout(800)
        await page.screenshot({ path: `docs/adr/pagination-evidence/print-page-${number}.png` })
      }
    }
  }
  await writeFile('docs/adr/pagination-evidence/pdf-counts.json', JSON.stringify(counts, null, 2) + '\n')
  console.log(counts)
} finally {
  await browser.close()
  await server.close()
}
