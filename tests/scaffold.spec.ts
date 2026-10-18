import { test, expect } from '@playwright/test'
import { strToU8, zipSync } from 'fflate'

test('restored workspace keeps content through tabs and paper view changes', async ({ page }) => {
  await page.goto('./#/draft')
  const editor = page.getByRole('textbox', { name: 'Document editor', exact: true })
  await editor.fill('Synthetic document retained through view changes.')
  await page.getByRole('tab', { name: 'Layout', exact: true }).click()
  await page.getByRole('combobox', { name: 'Paper size', exact: true }).selectOption('letter')
  await page.getByRole('combobox', { name: 'Orientation', exact: true }).selectOption('landscape')
  await expect(page.locator('.draft-page')).toHaveClass(/draft-page--letter draft-page--landscape/)
  await page.getByRole('tab', { name: 'View', exact: true }).click()
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('125')
  await expect(page.locator('.draft-page')).toHaveCSS('zoom', '1.25')
  await expect(editor).toHaveText('Synthetic document retained through view changes.')
  await expect(page.locator('.draft-title-bar')).toHaveCount(0)
  await expect(page.locator('.draft-ruler')).toBeVisible()
  await page.getByRole('tab', { name: 'Format', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeVisible()
})

test('catalog card opens the editor and footer opens the legal notice', async ({ page }) => {
  await page.goto('./')
  await expect(page.locator('.all-directory-title')).toHaveText(/All\s*Suite/)
  await page.getByRole('button', { name: 'Open Draft', exact: true }).click()
  await expect(page).toHaveURL(/\/AllSuite\/apps\/draft$/)
  await expect(page.getByRole('textbox', { name: 'Document editor', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'File', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
  await expect(page.locator('input[type=file]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Back to AllSuite' }).click()
  await page.locator('.home-page').evaluate((element) => element.scrollTo(0, element.scrollHeight))
  await page.getByRole('button', { name: 'Legal Notice & Privacy', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Privacy', exact: true })).toBeVisible()
})

test('lazy app route shows a loading status while its bundle loads', async ({ page }) => {
  await page.goto('./')
  await page.route('**/assets/*.js', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500))
    await route.continue()
  })

  await page.getByRole('button', { name: 'Open Draft', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Loading…')
  await expect(page.getByRole('textbox', { name: 'Document editor', exact: true })).toBeVisible()
})

test('@smoke Polish preferences and blocked browser storage both work', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('allsuite:locale', 'pl')
    localStorage.setItem('allsuite:theme', 'e-ink-light')
  })
  await page.goto('./#/draft')
  await expect(page.getByRole('textbox', { name: 'Edytor dokumentu', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Plik', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Zapisz', exact: true })).toBeEnabled()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'e-ink-light')
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get: () => {
        throw new Error('Storage denied')
      },
    })
  })
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Document editor', exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('@smoke e-ink keeps the home hero visible with motion disabled', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('allsuite:theme', 'e-ink-dark'))
  await page.goto('./')
  await expect(page.getByRole('heading', { level: 1, name: /All\s*Suite/ })).toBeVisible()
})

test('header changes language, theme and e-reader mode', async ({ page }) => {
  await page.goto('./#/draft')
  await page.getByRole('button', { name: 'Open preferences menu', exact: true }).click()
  await expect(page.getByText('E-reader mode', { exact: true })).toBeVisible()
  await expect(page.locator('#header-menu-toggle')).toHaveCSS('width', '36px')
  await expect(page.locator('#header-menu-toggle')).toHaveCSS('height', '36px')
  const optionHeight = await page
    .locator('.all-header-menu-option')
    .first()
    .evaluate((element) => element.getBoundingClientRect().height)
  expect(optionHeight).toBeLessThan(44)
  await page.getByRole('button', { name: 'Light', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('button', { name: 'On', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'e-ink-light')
  await page.getByRole('button', { name: 'Polski', exact: true }).click()
  await expect(page.getByText('Tryb czytnika', { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Edytor dokumentu', exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('allsuite:theme'))).toBe('e-ink-light')
  expect(await page.evaluate(() => localStorage.getItem('allsuite:locale'))).toBe('pl')
})

test('localized footer matches sibling modules on the legal and privacy label', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Open preferences menu', exact: true }).click()
  await page.getByRole('button', { name: 'Polski', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Nota prawna & Prywatność', exact: true })).toBeVisible()
})

test('touch menu controls keep shared visual sizing and 44px activation areas', async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:4176/AllSuite/',
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  })
  try {
    const page = await context.newPage()
    await page.goto('#/draft')
    const toggle = page.locator('#header-menu-toggle')
    await expect(toggle).toHaveCSS('width', '36px')
    const toggleTarget = await toggle.evaluate((element) => {
      const style = getComputedStyle(element, '::after')
      return { width: style.width, height: style.height }
    })
    expect(toggleTarget).toEqual({ width: '44px', height: '44px' })

    await toggle.click()
    const optionTarget = await page
      .locator('.all-header-menu-option')
      .first()
      .evaluate((element) => {
        const style = getComputedStyle(element, '::after')
        return { width: style.width, height: style.height }
      })
    expect(optionTarget).toEqual({ width: '44px', height: '44px' })
  } finally {
    await context.close()
  }
})

test('@smoke production CSP, static-only PWA cache and offline lazy route', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.goto('./')
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  expect(csp).toContain("connect-src 'self' blob: data:")
  expect(csp).toContain("worker-src 'self' blob:")
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  const cache = await page.evaluate(async () => {
    const entries = await Promise.all(
      (await caches.keys()).map(async (key) => {
        const cache = await caches.open(key)
        return (await cache.keys()).map((request) => new URL(request.url).pathname)
      }),
    )
    return entries.flat()
  })
  expect(cache.length).toBeGreaterThan(0)
  expect(
    cache.every(
      (path) =>
        /\.(?:js|css|html|svg|woff2?|webmanifest|wasm)$/.test(path) || path.endsWith('/third-party-licenses.txt'),
    ),
  ).toBe(true)
  await page.context().setOffline(true)
  await page.goto('./#/draft')
  await expect(page.getByRole('textbox', { name: 'Document editor', exact: true })).toBeVisible()
  await page.goto('./#/grid')
  await expect(page.getByRole('grid', { name: 'Spreadsheet grid' })).toBeVisible()
  expect(requests.every((url) => new URL(url).origin === 'http://127.0.0.1:4176')).toBe(true)
  const storage = await page.evaluate(async () => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
    databases: typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [],
  }))
  expect(
    storage.local.every((key) =>
      ['allsuite:locale', 'allsuite:theme', 'allsuite:draft:view-preferences', 'allsuite:draft:image-options'].includes(
        key,
      ),
    ),
  ).toBe(true)
  expect(storage.session).toEqual([])
  expect(storage.databases).toEqual([])
})

test('@smoke a service worker controller change preserves an unsaved document', async ({ page }) => {
  await page.goto('./#/draft')
  const editor = page.getByRole('textbox', { name: 'Document editor', exact: true })
  await editor.fill('Keep this unsaved document during an update.')
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange')))
  await expect(editor).toHaveText('Keep this unsaved document during an update.')
  await expect(page.getByRole('status')).toContainText('Unsaved changes')
})

test('@smoke fallback file input opens text and explicit save downloads DOCX', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true })
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
  await page.goto('./#/draft')
  expect(
    await page.evaluate(() => typeof (window as Window & { showOpenFilePicker?: unknown }).showOpenFilePicker),
  ).toBe('undefined')
  await page.getByRole('tab', { name: 'File', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await (await chooser).setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Private\nnotes') })
  await expect(page.getByRole('textbox', { name: 'Document editor', exact: true })).toContainText('Private')
  await expect(page.getByRole('textbox', { name: 'Document editor', exact: true })).toContainText('notes')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  expect((await download).suggestedFilename()).toBe('notes.docx')
  expect(
    (await page.evaluate(() => Object.keys(localStorage))).every((key) =>
      ['allsuite:locale', 'allsuite:theme', 'allsuite:draft:view-preferences', 'allsuite:draft:image-options'].includes(
        key,
      ),
    ),
  ).toBe(true)
})

test('DOCX import report requires a decision before replacing the document', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true }),
  )
  await page.goto('./#/draft')
  await page.getByRole('tab', { name: 'File', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  const fixture = zipSync({
    'word/document.xml': strToU8(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Imported safely</w:t></w:r></w:p><w:drawing><w:chart/></w:drawing></w:body></w:document>',
    ),
  })
  await (
    await chooser
  ).setFiles({
    name: 'unsupported.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from(fixture),
  })
  const dialog = page.getByRole('dialog', { name: 'Import report', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.all-dialog__footer')).toHaveCount(0)
  await expect(dialog).toContainText('chart')
  await expect(page.getByRole('textbox', { name: 'Document editor', exact: true })).not.toContainText('Imported safely')
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Document editor', exact: true })).toContainText('Imported safely')
})

test('Draft toolbar preserves AllUI control geometry and typography', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.addInitScript(() => localStorage.setItem('allsuite:theme', 'dark'))
  await page.goto('./#/draft')
  await expect(page.getByRole('textbox', { name: 'Document editor', exact: true })).toBeVisible()

  const bold = page.getByRole('button', { name: 'Bold', exact: true })
  await expect(bold).toHaveClass(/all-icon-btn/)
  const typography = await bold.evaluate((element) => ({
    control: getComputedStyle(element).fontFamily,
    shared: getComputedStyle(document.documentElement).getPropertyValue('--all-font-sans'),
  }))
  expect(typography.control).toContain('Inter')
  expect(typography.shared).toContain('Inter')
  await page.locator('.draft-tools').screenshot({ path: 'test-results/draft-toolbar-format-allui.png' })

  await page.getByRole('tab', { name: 'Insert', exact: true }).click()

  await page.getByRole('tab', { name: 'Layout', exact: true }).click()

  await page.getByRole('tab', { name: 'View', exact: true }).click()
  const rulerButton = page.getByRole('button', { name: 'Ruler', exact: true })
  await expect(rulerButton).toHaveClass(/all-btn--sm/)
  await expect(rulerButton).toHaveAttribute('aria-pressed', 'true')
  expect(await rulerButton.evaluate((element) => getComputedStyle(element).height)).toBe('32px')
})

test('Draft and Grid toolbars stay one row and page overflowing groups', async ({ page }) => {
  const verifyPager = async (toolbarSelector: string) => {
    const tabs = page.locator('.all-workspace-tabs')
    await expect(tabs).toBeVisible()
    expect(await tabs.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
    const toolbar = page.locator(toolbarSelector)
    await expect(toolbar.locator('..')).toHaveCSS('height', '72px')
    const visibleGroups = toolbar.locator('.all-toolbar-group:visible')
    const groupTops = await visibleGroups.evaluateAll((groups) =>
      groups.map((group) => Math.round(group.getBoundingClientRect().top)),
    )
    expect(new Set(groupTops).size).toBe(1)
    const firstPage = await toolbar
      .locator('.all-toolbar-group')
      .evaluateAll((groups) => groups.map((group) => getComputedStyle(group).display !== 'none'))

    const next = page.getByRole('button', { name: /Next toolbar page/ })
    await expect(next).toBeVisible()
    await next.click()
    await expect
      .poll(() =>
        toolbar
          .locator('.all-toolbar-group')
          .evaluateAll((groups) => groups.map((group) => getComputedStyle(group).display !== 'none')),
      )
      .not.toEqual(firstPage)
    expect(await toolbar.evaluate((element) => element.scrollLeft)).toBe(0)
    const previous = page.getByRole('button', { name: /Previous toolbar page/ })
    await expect(previous).toBeEnabled()
    await previous.click()
    await expect
      .poll(() =>
        toolbar
          .locator('.all-toolbar-group')
          .evaluateAll((groups) => groups.map((group) => getComputedStyle(group).display !== 'none')),
      )
      .toEqual(firstPage)
  }

  await page.goto('./apps/draft')
  await page.getByRole('tab', { name: 'Format', exact: true }).click()
  await verifyPager('.draft-toolbar--formatting')

  await page.goto('./apps/grid')
  await page.getByRole('tab', { name: 'Format', exact: true }).click()
  await verifyPager('.grid-format-toolbar')
})

test('Draft dialog actions stay on the same surface as their content', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.addInitScript(() => localStorage.setItem('allsuite:theme', 'dark'))
  await page.goto('./#/draft')
  await page.getByRole('tab', { name: 'Layout', exact: true }).click()
  await page.getByRole('button', { name: 'Open paragraph settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Paragraph settings', exact: true })
  await expect(dialog.locator('.all-dialog__footer')).toHaveCount(0)
  await expect(dialog.locator('.draft-dialog-actions')).toContainText('Cancel')
})

for (const { width, height } of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 820, height: 1180 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
]) {
  for (const theme of ['dark', 'light', 'e-ink-light', 'e-ink-dark']) {
    test(`@slow Draft theme token check ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      await page.addInitScript((theme) => localStorage.setItem('allsuite:theme', theme), theme)
      await page.goto('./#/draft')
      await expect(page.getByRole('textbox', { name: 'Document editor', exact: true })).toBeVisible()
      await page
        .getByRole('textbox', { name: 'Document editor', exact: true })
        .fill('A clear space for your ideas.\nWrite, format and keep your work on your device.')
      await page.evaluate(() => document.fonts.ready)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      const colors = await page.evaluate(() => ({
        root: getComputedStyle(document.documentElement).getPropertyValue('--all-bg').trim(),
        app: getComputedStyle(document.querySelector('.draft-app')!).getPropertyValue('--all-bg').trim(),
      }))
      expect(colors.app).toBe(colors.root)
      await expect(page.locator('html')).toHaveAttribute('data-motion', theme.startsWith('e-ink') ? 'none' : 'normal')
      await page.screenshot({ path: `test-results/draft-restored-${width}-${theme}.png` })
    })
  }
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 820, height: 1180 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
]) {
  test(`@slow document scroll stays inside the pane at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('./#/draft')
    await expect(page.getByRole('textbox', { name: 'Document editor', exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'none')
    const touchControls =
      viewport.width <= 900 ? '.header-logo, .draft-toolbar button:not([role="switch"])' : '.header-logo'
    // Header menu uses shared 36px visuals and a 44px coarse-pointer pseudo target;
    // the dedicated hasTouch test above verifies that activation area.
    for (const button of await page.locator(touchControls).all()) {
      const box = await button.boundingBox()
      expect(box?.width).toBeGreaterThanOrEqual(44)
      expect(box?.height).toBeGreaterThanOrEqual(44)
    }
    await page.locator('.tiptap').evaluate((paper) => {
      for (let i = 0; i < 60; i++) {
        const paragraph = document.createElement('p')
        paragraph.textContent = 'Synthetic layout audit content.'
        paper.appendChild(paragraph)
      }
    })
    await page.getByRole('region', { name: 'Document area' }).evaluate((pane) => pane.scrollTo(0, pane.scrollHeight))
    const geometry = await page.evaluate(() => {
      const pane = document.querySelector('.draft-document-area')!
      const toolbar = document.querySelector('.draft-toolbar')!.getBoundingClientRect()
      const status = document.querySelector('[role=status]')!.getBoundingClientRect()
      return {
        paneScroll: pane.scrollTop,
        pageScroll: document.scrollingElement!.scrollTop,
        pageWidth: document.documentElement.scrollWidth,
        toolbarTop: toolbar.top,
        statusBottom: status.bottom,
      }
    })
    expect(geometry.paneScroll).toBeGreaterThan(0)
    expect(geometry.pageScroll).toBe(0)
    expect(geometry.pageWidth).toBeLessThanOrEqual(viewport.width)
    expect(geometry.toolbarTop).toBeGreaterThanOrEqual(0)
    expect(geometry.statusBottom).toBeLessThanOrEqual(viewport.height)
  })
}
