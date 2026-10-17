import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { strFromU8, unzipSync } from 'fflate'
import { chartDocx, chartXML } from './fixtures/charts'

for (const theme of ['dark', 'light', 'e-ink-light', 'e-ink-dark']) {
  test(`static chart viewport audit ${theme}`, async ({ page }) => {
    await page.addInitScript((value) => {
      localStorage.setItem('allsuite:theme', value)
      Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true })
    }, theme)
    await page.goto('./#/draft')
    await page.getByRole('tab', { name: 'File', exact: true }).click()
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Open', exact: true }).click()
    await (
      await chooser
    ).setFiles({
      name: 'charts.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from(chartDocx()),
    })
    await page
      .getByRole('dialog', { name: 'Import report', exact: true })
      .getByRole('button', { name: 'Continue', exact: true })
      .click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    for (const [width, height] of [
      [390, 844],
      [844, 390],
      [820, 1180],
      [1280, 800],
      [1920, 1080],
    ]) {
      await page.setViewportSize({ width, height })
      await expect(page.locator('.tiptap img[src]')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: `docs/charts-audit/${theme}-${width}.png` })
    }
  })
}

for (const type of ['barChart', 'lineChart', 'pieChart', 'scatterChart', 'missingCache']) {
  test(`imports ${type} and saves static pictures`, async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true })
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
    })
    await page.goto('./#/draft')
    await page.getByRole('tab', { name: 'File', exact: true }).click()
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Open', exact: true }).click()
    await (
      await chooser
    ).setFiles({
      name: 'charts.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from(chartDocx(type === 'missingCache' ? chartXML('barChart', '') : chartXML(type))),
    })
    const report = page.getByRole('dialog', { name: 'Import report', exact: true })
    await expect(report).toContainText(
      type === 'scatterChart' || type === 'missingCache' ? 'could not be rendered' : 'converted to images',
    )
    await report.getByRole('button', { name: 'Continue', exact: true }).click()
    const editor = page.locator('.tiptap')
    await expect(editor).toContainText('Before chart')
    await expect(editor).toContainText('After chart')
    if (type === 'missingCache') {
      await expect(editor.locator('img')).toHaveCount(0)
      return
    }
    const image = editor.locator('img[src]')
    await expect(image).toHaveAttribute('src', /^data:image\/png;base64,/)
    await expect(image).toHaveAttribute('alt', 'Quarterly sales; Revenue')
    expect(await image.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(640)
    await page.screenshot({ path: `docs/charts-audit/${type}.png` })
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    const files = unzipSync(await readFile((await (await download).path())!))
    expect(Object.keys(files).some((path) => /^word\/(charts|embeddings)\//.test(path))).toBe(false)
    expect(strFromU8(files['word/document.xml'])).toContain('pic:pic')
    expect(strFromU8(files['word/_rels/document.xml.rels'])).toContain('/image')
  })
}
