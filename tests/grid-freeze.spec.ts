import { gridCommand } from './helpers/grid-command'
import { expect, test, type Page } from '@playwright/test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { createWorkbook, WorkbookSession } from '../packages/apps/grid/src/engine/workbook'
import { columnNumberToName } from '../packages/apps/grid/src/engine/workbook/address'
import { exportXlsxWorkbook } from '../packages/apps/grid/src/engine/xlsx/export'
import { parseXlsxWorkbook } from '../packages/apps/grid/src/engine/xlsx/import'

const cell = (page: Page, address: string) => page.locator(`[data-cell-address="${address}"]`)
async function fixture() {
  const workbook = createWorkbook()
  const session = new WorkbookSession(workbook)
  session.setCells(
    workbook.activeSheetId,
    Array.from({ length: 60 }, (_, r) =>
      Array.from({ length: 20 }, (_, c) => ({
        address: `${columnNumberToName(c + 1)}${r + 1}`,
        value: {
          kind: 'string' as const,
          value: c === 1 && r > 0 ? (r % 2 ? 'keep' : 'drop') : `${columnNumberToName(c + 1)}${r + 1}`,
        },
      })),
    ).flat(),
  )
  session.setRowMetadata(workbook.activeSheetId, 2, { hidden: true })
  const saved = await exportXlsxWorkbook(workbook, 'freeze-source.xlsx')
  expect(saved.report.canSave).toBe(true)
  const parts = unzipSync(saved.bytes!)
  parts['xl/styles.xml'] = strToU8(
    strFromU8(parts['xl/styles.xml'])
      .replace(/theme="1"/g, 'rgb="FF000000"')
      .replace(/indexed="64"/g, 'rgb="FF000000"'),
  )
  return zipSync(parts)
}
async function open(page: Page, bytes: Uint8Array) {
  await page.locator('input[type="file"]').setInputFiles({
    name: 'freeze-source.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(bytes),
  })
  await page
    .getByRole('dialog', { name: 'Workbook compatibility check' })
    .getByRole('button', { name: 'Open workbook', exact: true })
    .click()
  await expect(cell(page, 'A1')).toHaveText('A1')
}
async function view(page: Page) {
  await page.getByRole('tab', { name: 'View', exact: true }).click()
}
async function jump(page: Page, address: string) {
  const box = page.getByRole('textbox', { name: 'Name box' })
  await box.fill(address)
  await box.press('Enter')
}
async function scroll(page: Page, left: number, top: number) {
  await page.getByRole('grid').evaluate(
    (el, offset) => {
      el.scrollLeft = offset.left
      el.scrollTop = offset.top
    },
    { left, top },
  )
  await expect.poll(() => page.getByRole('grid').evaluate((el) => [el.scrollLeft, el.scrollTop])).toEqual([left, top])
}

test('PP10 freezes actual cells on both axes and unfreezes', async ({ page }) => {
  await page.goto('./#/grid')
  await page.getByRole('tab', { name: 'View', exact: true }).click()
  await (await gridCommand(page, 'Freeze first row')).click()
  await (await gridCommand(page, 'Freeze first column')).click()
  const a1 = page.locator('[data-cell-address="A1"]')
  const before = (await a1.boundingBox())!
  await page.getByRole('grid').evaluate((el) => {
    el.scrollTop = 800
    el.scrollLeft = 900
  })
  await expect(a1).toHaveCount(1)
  await expect.poll(async () => (await a1.boundingBox())!.x).toBe(before.x)
  await expect.poll(async () => (await a1.boundingBox())!.y).toBe(before.y)
  await (await gridCommand(page, 'Unfreeze panes')).click()
  await expect(a1).toHaveCount(0)
})

for (const [rows, columns] of [
  [true, false],
  [false, true],
  [true, true],
]) {
  test(`PP10 data geometry rows=${rows} columns=${columns}, cross-boundary navigation and resize`, async ({ page }) => {
    await page.goto('./#/grid')
    await open(page, await fixture())
    await view(page)
    if (rows) await (await gridCommand(page, 'Freeze first row')).click()
    if (columns) await (await gridCommand(page, 'Freeze first column')).click()
    const headerY = (await cell(page, 'D1').boundingBox())!.y
    const firstX = (await cell(page, 'A8').boundingBox())!.x
    const moving = (await cell(page, 'D8').boundingBox())!
    await scroll(page, 150, 80)
    if (rows) await expect.poll(async () => (await cell(page, 'D1').boundingBox())!.y).toBe(headerY)
    if (columns) await expect.poll(async () => (await cell(page, 'A8').boundingBox())!.x).toBe(firstX)
    await expect.poll(async () => (await cell(page, 'D8').boundingBox())!.x).toBe(moving.x - 150)
    await expect.poll(async () => (await cell(page, 'D8').boundingBox())!.y).toBe(moving.y - 80)
    await scroll(page, 900, 800)
    if (rows) {
      await expect(cell(page, 'J1')).toHaveText('J1')
      await expect.poll(async () => (await cell(page, 'J1').boundingBox())!.y).toBe(headerY)
      await cell(page, 'J1').click()
      await expect(page.getByRole('textbox', { name: 'Name box' })).toHaveValue('J1')
      await expect(page.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('J1')
      await cell(page, 'J1').dblclick()
      const inCell = page.getByRole('textbox', { name: 'Edit cell J1', exact: true })
      await expect(inCell).toHaveCount(1)
      await expect(inCell).toBeFocused()
      await inCell.fill('Frozen edit')
      await inCell.press('Enter')
      await expect(cell(page, 'J1')).toHaveCount(1)
      await expect(cell(page, 'J1')).toHaveText('Frozen edit')
    }
    if (columns) {
      // Selecting a frozen column does not reset horizontal scrolling.
      await scroll(page, 900, 800)
      await expect(cell(page, 'A30')).toHaveText('A30')
      await expect.poll(async () => (await cell(page, 'A30').boundingBox())!.x).toBe(firstX)
      await cell(page, 'A30').click()
      await expect(page.getByRole('textbox', { name: 'Name box' })).toHaveValue('A30')
      await expect.poll(() => page.getByRole('grid').evaluate((el) => el.scrollLeft)).toBe(900)
    }
    await jump(page, 'A1')
    await scroll(page, 0, 0)
    await cell(page, 'A1').click()
    await cell(page, 'C4').click({ modifiers: ['Shift'] })
    for (const address of ['A1', 'B1', 'A3', 'B3', 'C4'])
      await expect(cell(page, address)).toHaveAttribute('aria-selected', 'true')
    await expect(cell(page, 'A2')).toHaveCount(0)
    await jump(page, 'B3')
    await page.getByRole('grid').press('ArrowLeft')
    await expect(page.getByRole('textbox', { name: 'Name box' })).toHaveValue('A3')
    await page.getByRole('grid').press('ArrowUp')
    await expect(page.getByRole('textbox', { name: 'Name box' })).toHaveValue('A1')
    await page.getByRole('grid').press('ArrowRight')
    await page.getByRole('grid').press('ArrowDown')
    await expect(page.getByRole('textbox', { name: 'Name box' })).toHaveValue('B3')
    const editor = page.getByRole('textbox', { name: 'Formula bar' })
    await editor.fill('Boundary edit')
    await editor.press('Enter')
    await expect(cell(page, 'B3')).toHaveText('Boundary edit')
    await jump(page, 'A1')
    const before = (await cell(page, 'A1').boundingBox())!
    const width = page.getByRole('slider', { name: 'Resize column A', exact: true })
    await width.focus()
    await width.press('ArrowRight')
    await expect.poll(async () => (await cell(page, 'A1').boundingBox())!.width).toBe(before.width + 8)
    const height = page.getByRole('slider', { name: 'Resize row 1', exact: true })
    await height.focus()
    await height.press('ArrowUp')
    await expect.poll(async () => (await cell(page, 'A1').boundingBox())!.height).toBe(before.height + 4)
    await scroll(page, 150, 80)
    if (rows) await expect.poll(async () => (await cell(page, 'D1').boundingBox())!.y).toBe(headerY)
    if (columns) await expect.poll(async () => (await cell(page, 'A8').boundingBox())!.x).toBe(firstX)
    await (await gridCommand(page, 'Unfreeze panes')).click()
    await expect(await gridCommand(page, 'Freeze first row')).toHaveAttribute('aria-pressed', 'false')
    await expect(await gridCommand(page, 'Freeze first column')).toHaveAttribute('aria-pressed', 'false')
    await jump(page, 'B3')
    await expect(cell(page, 'B3')).toHaveText('Boundary edit')
    await expect(page.getByRole('grid')).toHaveAttribute('aria-activedescendant', 'grid-cell-B3')
    await expect(page.getByRole('grid')).toBeFocused()
  })
}

test('PP10 frozen filter header, manual hiding, undo, XLSX download and fresh file-input reopen', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }),
  )
  await page.goto('./#/grid')
  await open(page, await fixture())
  await view(page)
  for (const name of ['Freeze first row', 'Freeze first column']) await (await gridCommand(page, name)).click()
  await page.getByRole('grid').focus()
  await page.getByRole('grid').press('Control+z')
  await expect(await gridCommand(page, 'Freeze first column')).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('grid').press('Control+y')
  await expect(await gridCommand(page, 'Freeze first column')).toHaveAttribute('aria-pressed', 'true')
  await jump(page, 'A1:B8')
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await (await gridCommand(page, 'AutoFilter')).click()
  const dialog = page.getByRole('dialog', { name: 'AutoFilter', exact: true })
  await dialog.getByRole('combobox', { name: 'Filter column', exact: true }).selectOption('2')
  await dialog.getByRole('button', { name: 'Deselect all values', exact: true }).click()
  await dialog.getByRole('checkbox', { name: 'keep', exact: true }).check()
  await dialog.getByRole('button', { name: 'Apply filter', exact: true }).click()
  for (const address of ['A2', 'A3', 'A5', 'A7']) await expect(cell(page, address)).toHaveCount(0)
  await cell(page, 'A1').click()
  await page.getByRole('grid').press('ArrowDown')
  await expect(page.getByRole('textbox', { name: 'Name box' })).toHaveValue('A4')
  await page.getByRole('grid').press('ArrowUp')
  await expect(page.getByRole('textbox', { name: 'Name box' })).toHaveValue('A1')
  await jump(page, 'A4')
  const formula = page.getByRole('textbox', { name: 'Formula bar' })
  await formula.fill('Saved boundary edit')
  await formula.press('Enter')
  await jump(page, 'A1')
  const originalSize = (await cell(page, 'A1').boundingBox())!
  const resizeColumn = page.getByRole('slider', { name: 'Resize column A', exact: true })
  await resizeColumn.focus()
  await resizeColumn.press('ArrowRight')
  const resizeRow = page.getByRole('slider', { name: 'Resize row 1', exact: true })
  await resizeRow.focus()
  await resizeRow.press('ArrowUp')
  await expect.poll(async () => (await cell(page, 'A1').boundingBox())!.width).toBe(originalSize.width + 8)
  await expect.poll(async () => (await cell(page, 'A1').boundingBox())!.height).toBe(originalSize.height + 4)
  const fixed = (await cell(page, 'A1').boundingBox())!
  await scroll(page, 900, 800)
  await expect.poll(async () => (await cell(page, 'A1').boundingBox())!.y).toBe(fixed.y)
  await expect(cell(page, 'A1')).toHaveText('A1')
  const downloadPromise = page.waitForEvent('download')
  await (await gridCommand(page, 'Save As')).click()
  const download = await downloadPromise
  await download.saveAs('tmp/pp10/frozen-filter.xlsx')
  const stream = await download.createReadStream()
  if (!stream) throw new Error('Missing actual XLSX download')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const bytes = Buffer.concat(chunks)
  const parts = unzipSync(bytes)
  const xml = strFromU8(parts['xl/worksheets/sheet1.xml'])
  expect(xml).toContain('<pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/>')
  expect(xml).toContain('<selection pane="bottomRight" activeCell="B2" sqref="B2"/>')
  expect(xml).toContain('<filterColumn colId="1"><filters><filter val="keep"')
  expect(xml).toMatch(/<row[^>]*r="2"[^>]*hidden="1"/)
  expect(strFromU8(parts['xl/_rels/workbook.xml.rels'])).toContain('worksheets/sheet1.xml')
  const parsed = (await parseXlsxWorkbook('frozen-filter.xlsx', bytes)).workbook!
  const freshSession = new WorkbookSession(parsed)
  expect(freshSession.getCell(parsed.activeSheetId, 'A4')?.value).toEqual({
    kind: 'string',
    value: 'Saved boundary edit',
  })
  expect(freshSession.getCell(parsed.activeSheetId, 'A60')?.value).toEqual({ kind: 'string', value: 'A60' })
  expect(parsed.sheetsById.get(parsed.activeSheetId)!.frozenPane).toMatchObject({
    xSplit: 1,
    ySplit: 1,
    topLeftCell: 'B2',
  })
  const fresh = await page.context().newPage()
  await fresh.goto('./#/grid')
  await open(fresh, bytes)
  await view(fresh)
  for (const name of ['Freeze first row', 'Freeze first column'])
    await expect(await gridCommand(fresh, name)).toHaveAttribute('aria-pressed', 'true')
  const reopened = (await cell(fresh, 'A1').boundingBox())!
  expect(reopened.width).toBe(originalSize.width + 8)
  expect(reopened.height).toBe(originalSize.height + 4)
  await scroll(fresh, 900, 800)
  await expect.poll(async () => (await cell(fresh, 'A1').boundingBox())!.x).toBe(reopened.x)
  await expect.poll(async () => (await cell(fresh, 'A1').boundingBox())!.y).toBe(reopened.y)
  await cell(fresh, 'A1').click()
  await expect(fresh.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('A1')
  await fresh.getByRole('button', { name: 'File', exact: true }).click()
  await (await gridCommand(fresh, 'Clear filter')).click()
  await jump(fresh, 'A1')
  await scroll(fresh, 0, 0)
  await expect(cell(fresh, 'A2')).toHaveCount(0)
  await expect(cell(fresh, 'A3')).toHaveText('A3')
  await expect(cell(fresh, 'A4')).toHaveText('Saved boundary edit')
  await view(fresh)
  await (await gridCommand(fresh, 'Unfreeze panes')).click()
  await scroll(fresh, 900, 800)
  await expect(cell(fresh, 'A1')).toHaveCount(0)
  await fresh.close()
})

for (const [theme, width, height, polish] of [
  ['light', 1280, 800, false],
  ['dark', 390, 844, false],
  ['e-ink-light', 844, 390, true],
  ['e-ink-dark', 844, 390, false],
] as const) {
  test(`PP10 keyboard/touch ${theme} ${width}x${height} ${polish ? 'PL' : 'EN'}`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: width < 900,
      isMobile: width < 900,
      reducedMotion: 'reduce',
    })
    try {
      const page = await context.newPage()
      await page.addInitScript(
        ({ theme, polish }) => {
          localStorage.setItem('allsuite:theme', theme)
          localStorage.setItem('allsuite:locale', polish ? 'pl' : 'en')
        },
        { theme, polish },
      )
      await page.goto('http://127.0.0.1:4176/AllSuite/#/grid')
      await page.getByRole('tab', { name: polish ? 'Widok' : 'View', exact: true }).click()
      const row = page.getByRole('button', {
        name: polish ? 'Zamroź pierwszy wiersz' : 'Freeze first row',
        exact: true,
      })
      const column = page.getByRole('button', {
        name: polish ? 'Zamroź pierwszą kolumnę' : 'Freeze first column',
        exact: true,
      })
      await gridCommand(page, polish ? 'Zamroź pierwszy wiersz' : 'Freeze first row')
      await row.focus()
      await row.press('Tab')
      await column.press('Shift+Tab')
      await expect(row).toBeFocused()
      await expect.poll(() => row.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid')
      await row.press('Space')
      await expect(row).toHaveAttribute('aria-pressed', 'true')
      await row.press('Tab')
      await expect(column).toBeFocused()
      await column.press('Enter')
      await expect(column).toHaveAttribute('aria-pressed', 'true')
      for (const control of [row, column]) {
        const box = (await control.boundingBox())!
        expect(box.height).toBeGreaterThanOrEqual(44)
        expect(box.width).toBeGreaterThanOrEqual(44)
      }
      const originalWidth = (await cell(page, 'A1').boundingBox())!.width
      await page.getByRole('button', { name: polish ? 'Powiększ' : 'Zoom in', exact: true }).click()
      await expect.poll(async () => (await cell(page, 'A1').boundingBox())!.width).toBeCloseTo(originalWidth * 1.1, 1)
      // Touch portrait/landscape share the same data geometry, including zoom.
      const a1 = cell(page, 'A1')
      const bounds = (await a1.boundingBox())!
      expect(bounds.height).toBeGreaterThan(0)
      await scroll(page, 500, 500)
      await expect.poll(async () => (await a1.boundingBox())!.x).toBe(bounds.x)
      await expect.poll(async () => (await a1.boundingBox())!.y).toBe(bounds.y)
      if (width < 900) await a1.tap()
      else await a1.click()
      await expect(page.getByRole('grid')).toHaveAttribute('aria-activedescendant', 'grid-cell-A1')
      expect(await page.getByRole('gridcell').count()).toBeLessThan(800)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    } finally {
      await context.close()
    }
  })
}

test('PP10 unsupported imported split remains read-only and byte-preserved', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }),
  )
  const parts = unzipSync(await fixture())
  const viewXml =
    '<sheetViews><sheetView workbookViewId="0"><pane xSplit="2400" topLeftCell="C1" activePane="topRight" state="split"/><selection pane="topRight" activeCell="C1" sqref="C1 E4"/></sheetView></sheetViews>'
  parts['xl/worksheets/sheet1.xml'] = strToU8(
    strFromU8(parts['xl/worksheets/sheet1.xml']).replace('<sheetFormatPr', `${viewXml}<sheetFormatPr`),
  )
  const source = zipSync(parts)
  await page.goto('./#/grid')
  await open(page, source)
  await view(page)
  const freeze = await gridCommand(page, 'Freeze first row')
  await freeze.click()
  await expect(freeze).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('status')).toContainText('Imported complex worksheet views cannot be changed')
  await expect(page.locator('.grid-app')).not.toHaveAttribute('data-dirty', 'true')
  await page.getByRole('button', { name: 'File', exact: true }).click()
  const downloaded = page.waitForEvent('download')
  await (await gridCommand(page, 'Save As')).click()
  const stream = await (await downloaded).createReadStream()
  if (!stream) throw new Error('Missing source-preservation download')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  expect(Buffer.concat(chunks)).toEqual(Buffer.from(source))
})
