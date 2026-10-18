import { expect, test } from '@playwright/test'
test('real browser WASM engine recalculates cross-sheet references, detects cycles and accepts canonical PL input', async ({
  page,
}) => {
  const external: string[] = []
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:5187/')) external.push(request.url())
  })
  await page.goto('http://127.0.0.1:5187/docs/spikes/grid/review/engine.html')
  await expect(page.locator('#result')).not.toHaveText('Loading', { timeout: 30000 })
  const result = JSON.parse(await page.locator('#result').innerText())
  expect(result.before).toBe(10)
  expect(result.after).toBe(14)
  expect(JSON.stringify(result.cycle)).toContain('CIRC')
  expect(result.localized).toEqual(
    expect.objectContaining({ canonicalExpression: '=SUM(Input!A1,1.5)', supportedSyntax: true }),
  )
  expect(result.localizedValue).toBe(8.5)
  expect(external).toEqual([])
})

test('records the existing production CSP as a WASM integration blocker', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/engine.html', async (route) => {
    const response = await route.fetch()
    const body = (await response.text()).replace(
      '<head>',
      '<head><meta http-equiv="Content-Security-Policy" content="default-src &#39;self&#39;; script-src &#39;self&#39;; connect-src &#39;self&#39; blob: data:">',
    )
    await route.fulfill({ response, body })
  })
  await page.goto('http://127.0.0.1:5187/docs/spikes/grid/review/engine.html')
  await expect
    .poll(() => errors.join('\n'))
    .toMatch(
      /WebAssembly.*(?:Content Security Policy|unsafe-eval)|(?:Content Security Policy|unsafe-eval).*WebAssembly/i,
    )
  await expect(page.locator('#result')).toHaveText('Loading')
})
