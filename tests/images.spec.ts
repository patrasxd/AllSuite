import { test, expect, type Page } from '@playwright/test'
import { generatedPNG } from './fixtures/png'
import { unzipSync } from 'fflate'

async function insertFile(page: Page, width = 240, height = 120, maxEdge?: number, keepOriginal = false) {
  await page.getByRole('tab', { name: 'Insert', exact: true }).click()
  await page.getByRole('button', { name: 'Insert image', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Insert image', exact: true })
  if (maxEdge) await dialog.getByRole('spinbutton', { name: 'Maximum image edge (px)' }).fill(String(maxEdge))
  if (keepOriginal) await dialog.getByRole('button', { name: 'Keep original', exact: true }).click()
  await dialog
    .getByLabel('Image files', { exact: true })
    .setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(generatedPNG(width, height)) })
  await dialog.getByRole('textbox', { name: 'Alt text', exact: true }).fill('Synthetic blue image')
  await dialog.getByRole('button', { name: 'Insert image', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.tiptap img[src]').last()).toHaveAttribute('alt', 'Synthetic blue image')
}

test('insert, resize with handles and keyboard, edit alt, save/reopen and release history on New', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true })
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
  await page.goto('./#/draft')
  await insertFile(page)
  const image = page.locator('.tiptap img[src]')
  await page.locator('.tiptap').press('ArrowLeft')
  const tools = page.getByRole('toolbar', { name: 'Image tools', exact: true })
  await expect(tools).toBeVisible()
  await page.keyboard.press('Alt+Shift+ArrowRight')
  await expect(image).toHaveAttribute('width', '250')
  const handle = page.getByRole('button', { name: 'Resize image bottom right', exact: true })
  let box = (await handle.boundingBox())!
  await page.mouse.move(box.x + 22, box.y + 22)
  await page.mouse.down()
  await page.mouse.move(box.x + 62, box.y + 32, { steps: 5 })
  await page.mouse.up()
  const ratio = Number(await image.getAttribute('width')) / Number(await image.getAttribute('height'))
  expect(ratio).toBeCloseTo(2, 1)
  const previousRatio = ratio
  box = (await handle.boundingBox())!
  await page.keyboard.down('Shift')
  await page.mouse.move(box.x + 22, box.y + 22)
  await page.mouse.down()
  await page.mouse.move(box.x + 32, box.y + 62, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  expect(Number(await image.getAttribute('width')) / Number(await image.getAttribute('height'))).toBeLessThan(
    previousRatio - 0.1,
  )
  await page.keyboard.press('Control+Alt+a')
  const altDialog = page.getByRole('dialog', { name: 'Alt text', exact: true })
  await altDialog.getByRole('textbox', { name: 'Alt text', exact: true }).fill('Edited with keyboard')
  await altDialog.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(image).toHaveAttribute('alt', 'Edited with keyboard')
  await tools.getByRole('combobox', { name: 'Image alignment', exact: true }).selectOption('center')
  await tools.getByRole('combobox', { name: 'Text wrapping', exact: true }).selectOption('top-bottom')
  await expect(page.locator('.draft-image')).toHaveAttribute('data-wrap', 'top-bottom')
  const width = await image.getAttribute('width')
  await page.getByRole('tab', { name: 'File', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const chunks: Buffer[] = []
  for await (const chunk of await (await downloading).createReadStream()) chunks.push(Buffer.from(chunk))
  await expect(page.getByRole('status')).toContainText('Ready')
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await expect(image).toHaveCount(0)
  await page.locator('.tiptap').press('Control+z')
  await expect(image).toHaveCount(0)
  const choosing = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await (
    await choosing
  ).setFiles({
    name: 'image-roundtrip.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.concat(chunks),
  })
  await expect(image).toHaveAttribute('alt', 'Edited with keyboard')
  await expect(image).toHaveAttribute('width', width!)
  await expect(page.locator('.draft-image')).toHaveAttribute('data-alignment', 'center')
  await expect(page.locator('.draft-image')).toHaveAttribute('data-wrap', 'top-bottom')
})

test('downscales large images while keep-original preserves pixels', async ({ page }) => {
  await page.goto('./#/draft')
  await insertFile(page, 1600, 800, 640)
  await expect(page.locator('.tiptap img[src]')).toHaveAttribute('width', '640')
  await expect(page.locator('.tiptap img[src]')).toHaveAttribute('height', '320')
  expect(await page.locator('.tiptap img[src]').evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(640)
  await page.locator('.tiptap').press('ArrowRight')
  await insertFile(page, 1600, 800, 640, true)
  expect(
    await page
      .locator('.tiptap img[src]')
      .last()
      .evaluate((img) => (img as HTMLImageElement).naturalWidth),
  ).toBe(1600)
})

test('native clipboard and drop support raster and sanitized SVG without document persistence or remote requests', async ({
  page,
}) => {
  const remote: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('unsafe.test')) remote.push(request.url())
  })
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (/data:image|Synthetic|<svg/i.test(value)) throw new Error('Document storage write')
      set.call(this, key, value)
    }
  })
  await page.goto('./#/draft')
  const editor = page.locator('.tiptap')
  await editor.focus()
  await editor.evaluate(
    (element, bytes) => {
      const data = new DataTransfer()
      data.items.add(new File([new Uint8Array(bytes)], 'paste.png', { type: 'image/png' }))
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
    },
    Array.from(generatedPNG(120, 60)),
  )
  await expect(editor.locator('img[src]')).toHaveCount(1)
  await editor.evaluate((element) => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" onload="evil()"><script>evil()</script><image href="https://unsafe.test/i"/><rect width="120" height="60" fill="#4477aa"/></svg>'
    const data = new DataTransfer()
    data.items.add(new File([svg], 'safe.svg', { type: 'image/svg+xml' }))
    const rect = element.getBoundingClientRect()
    element.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: data,
        clientX: rect.x + 15,
        clientY: rect.y + 15,
      }),
    )
  })
  await expect(editor.locator('img[src]')).toHaveCount(2)
  const svgSource = await editor.locator('img[src^="data:image/svg"]').getAttribute('src')
  expect(Buffer.from(svgSource!.split(',')[1], 'base64').toString()).not.toMatch(/script|onload|unsafe.test/)
  expect(remote).toEqual([])
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => !key.startsWith('allsuite:')))).toEqual([])
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([])
})

test('JPEG, GIF, WebP and embedded clipboard HTML images are accepted', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }),
  )
  await page.goto('./#/draft')
  const sources = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 80
    canvas.height = 40
    canvas.getContext('2d')!.fillRect(0, 0, 80, 40)
    return [
      canvas.toDataURL('image/jpeg'),
      canvas.toDataURL('image/webp'),
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
    ]
  })
  const editor = page.locator('.tiptap')
  for (const src of sources) {
    await editor.focus()
    await editor.evaluate((element, source) => {
      const [header, base64] = source.split(',')
      const mime = header.slice(5).split(';')[0]
      const bytes = Uint8Array.from(atob(base64), (value) => value.charCodeAt(0))
      const data = new DataTransfer()
      data.items.add(new File([bytes], `image.${mime.split('/')[1]}`, { type: mime }))
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
    }, src)
    await expect(editor.locator(`img[src^="${src.slice(0, src.indexOf(','))}"]`)).toHaveCount(1)
  }
  await editor.evaluate(
    (element, bytes) => {
      const data = new DataTransfer()
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      data.setData(
        'text/html',
        `<p>Embedded <img alt="HTML image" src="data:image/png;base64,${btoa(binary)}" width="80" height="40"><img src="https://unsafe.test/tracker"></p>`,
      )
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
    },
    Array.from(generatedPNG(80, 40)),
  )
  await expect(editor.locator('img[alt="HTML image"]')).toHaveCount(1)
  await page.getByRole('tab', { name: 'File', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const chunks: Buffer[] = []
  for await (const chunk of await (await downloading).createReadStream()) chunks.push(Buffer.from(chunk))
  const media = Object.keys(unzipSync(Buffer.concat(chunks))).filter((name) => name.startsWith('word/media/'))
  expect(media.some((name) => name.endsWith('.jpg'))).toBe(true)
  expect(media.some((name) => name.endsWith('.gif'))).toBe(true)
  expect(media.filter((name) => name.endsWith('.png'))).toHaveLength(2)
})

for (const locale of ['en', 'pl']) {
  for (const theme of ['dark', 'light', 'e-ink-light', 'e-ink-dark']) {
    test(`image insertion uses compact AllUI dialog controls in ${locale} ${theme}`, async ({ page }) => {
      await page.setViewportSize(locale === 'en' ? { width: 1280, height: 800 } : { width: 390, height: 844 })
      await page.addInitScript((value) => localStorage.setItem('allsuite:locale', value), locale)
      await page.addInitScript((value) => localStorage.setItem('allsuite:theme', value), theme)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto('./#/draft')
      await page.getByRole('tab', { name: locale === 'en' ? 'Insert' : 'Wstawianie', exact: true }).click()
      const label = locale === 'en' ? 'Insert image' : 'Wstaw obraz'
      await page.getByRole('button', { name: label, exact: true }).click()
      const dialog = page.getByRole('dialog', { name: label, exact: true })
      const alt = dialog.getByRole('textbox', {
        name: locale === 'en' ? 'Alt text' : 'Tekst alternatywny',
        exact: true,
      })
      expect(
        await alt.evaluate((input) =>
          input.closest('.all-input-container')!.classList.contains('all-input-container--compact'),
        ),
      ).toBe(true)
      await expect(alt).toHaveAttribute('aria-describedby', /helper/)
      await expect(dialog).toHaveCSS('opacity', '1')
      await page.screenshot({ path: `test-results/image-dialog-${locale}-${theme}.png`, animations: 'disabled' })
      await expect(page).toHaveScreenshot(`image-dialog-${locale}-${theme}.png`)
      await expect(dialog.getByLabel(locale === 'en' ? 'Image files' : 'Pliki obrazów', { exact: true })).toBeHidden()
      const chooser = page.waitForEvent('filechooser')
      await dialog.getByRole('button', { name: locale === 'en' ? 'Choose images' : 'Wybierz obrazy' }).click()
      await (await chooser).setFiles({ name: 'sample.png', mimeType: 'image/png', buffer: Buffer.from(generatedPNG()) })
      await expect(dialog.getByRole('status')).toHaveText('sample.png')
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
    })
  }
}

for (const theme of ['dark', 'light', 'e-ink-light', 'e-ink-dark']) {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 820, height: 1180 },
    { width: 1280, height: 800 },
    { width: 1920, height: 1080 },
  ]) {
    test(`image viewport ${theme} ${viewport.width}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.addInitScript((value) => localStorage.setItem('allsuite:theme', value), theme)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto('./#/draft')
      await insertFile(page)
      await page.locator('.tiptap img[src]').click()
      await page.locator('.tiptap img[src]').evaluate((image) => (image as HTMLImageElement).decode())
      const tools = page.getByRole('toolbar', { name: 'Image tools', exact: true })
      await expect(tools).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width)
      const pane = (await page.locator('.draft-document-area').boundingBox())!
      expect(pane.height).toBeGreaterThan(80)
      for (const handle of await page.locator('.draft-image-handle').all()) {
        const box = (await handle.boundingBox())!
        expect(box.height).toBeGreaterThanOrEqual(44)
        expect(box.width).toBeGreaterThanOrEqual(44)
      }
      if (viewport.width <= 900)
        for (const control of await tools.locator('button,input,select').all())
          expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await page.screenshot({ path: `test-results/image-${theme}-${viewport.width}.png` })
      if (viewport.width === 390 || viewport.width === 1280)
        await expect(page).toHaveScreenshot(`image-${theme}-${viewport.width}.png`)
    })
  }
}
